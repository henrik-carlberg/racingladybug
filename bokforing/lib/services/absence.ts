import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { today } from '@/lib/format';
import { KIND_LABEL, leaveItems, sickItems, vacationDaysTaken, vacationItems, workdays, type AbsenceKind } from '@/lib/absence';
import { percentRuleVacation } from '@/lib/payroll-extras';
import { sameRuleVacation } from '@/lib/payroll-agreements';
import type { Actor } from './actor';
import { date, int, optInt, str } from './input';
import { updatePayslip } from './payroll';

export interface AbsenceOut {
  id: number; employee_id: number; employee: string; kind: AbsenceKind; kind_label: string; from: string; to: string; extent: number;
  status: 'requested' | 'approved' | 'rejected'; note: string; payroll_run_id: number | null; period: string | null;
}

export async function listAbsences(companyId: number, f: { employee_id?: number; status?: string; year?: number } = {}): Promise<AbsenceOut[]> {
  const rows = await sql<Omit<AbsenceOut, 'kind_label'>[]>`SELECT a.id, a.employee_id, e.first_name || ' ' || e.last_name AS employee, a.kind,
      to_char(a.from_date,'YYYY-MM-DD') AS "from", to_char(a.to_date,'YYYY-MM-DD') AS "to", a.extent, a.status, a.note, a.payroll_run_id, r.period
    FROM absences a JOIN employees e ON e.id = a.employee_id LEFT JOIN payroll_runs r ON r.id = a.payroll_run_id
    WHERE a.company_id = ${companyId} ${f.employee_id ? sql`AND a.employee_id = ${f.employee_id}` : sql``} ${f.status ? sql`AND a.status = ${f.status}` : sql``}
      ${f.year ? sql`AND EXTRACT(YEAR FROM a.from_date) <= ${f.year} AND EXTRACT(YEAR FROM a.to_date) >= ${f.year}` : sql``}
    ORDER BY a.from_date DESC, a.id DESC LIMIT 500`;
  return rows.map((a) => ({ ...a, kind_label: KIND_LABEL[a.kind] }));
}

/** Registrerar frånvaro. Anställda anmäler sjukdom/VAB direkt och ansöker om semester och ledighet (godkänns av ägare/konsult). */
export async function createAbsence(actor: Actor & { employeeId?: number | null }, input: Record<string, unknown>) {
  const kind = str(input, 'kind') as AbsenceKind;
  if (!KIND_LABEL[kind]) throw new ValidationError('Välj typ av frånvaro');
  const employeeId = actor.role === 'employee' ? actor.employeeId : int(input, 'employee_id', 'Anställd');
  if (!employeeId) throw new ValidationError('Ditt konto är inte kopplat till en anställd');
  const [e] = await sql`SELECT 1 FROM employees WHERE id = ${employeeId} AND company_id = ${actor.companyId}`;
  if (!e) throw new ValidationError('Den anställda finns inte');
  const from = date(input, 'from', 'Från'), to = date(input, 'to', 'Till', false) || from;
  if (to < from) throw new ValidationError('Slutdatum är före startdatum');
  const extent = optInt(input, 'extent', 'Omfattning') ?? 100;
  if (extent < 1 || extent > 100) throw new ValidationError('Omfattning ska vara 1–100 %');
  const overlap = await sql`SELECT 1 FROM absences WHERE employee_id = ${employeeId} AND status <> 'rejected' AND from_date <= ${to} AND to_date >= ${from}`;
  if (overlap.length) throw new ConflictError('Det finns redan frånvaro registrerad för de dagarna');
  const status = actor.role === 'employee' && (kind === 'vacation' || kind === 'leave' || kind === 'parental') ? 'requested' : 'approved';
  const [{ id }] = await sql<{ id: number }[]>`INSERT INTO absences (company_id, employee_id, kind, from_date, to_date, extent, status, note, created_by)
    VALUES (${actor.companyId}, ${employeeId}, ${kind}, ${from}, ${to}, ${extent}, ${status}, ${str(input, 'note')}, ${actor.userId}) RETURNING id`;
  await auditBy(sql, actor, 'create', 'absence', id, { kind, from, to, status });
  return { id, status };
}

export async function decide(actor: Actor, id: number, approve: boolean) {
  if (actor.role === 'employee') throw new ValidationError('Bara ägare och konsult kan godkänna');
  const r = await sql`UPDATE absences SET status = ${approve ? 'approved' : 'rejected'} WHERE id = ${id} AND company_id = ${actor.companyId} AND status = 'requested' RETURNING id`;
  if (!r.length) throw new ConflictError('Ansökan är redan hanterad');
  await auditBy(sql, actor, approve ? 'approve' : 'reject', 'absence', id);
}

export async function removeAbsence(actor: Actor & { employeeId?: number | null }, id: number) {
  const [a] = await sql<{ employee_id: number; status: string; payroll_run_id: number | null }[]>`SELECT employee_id, status, payroll_run_id FROM absences WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!a) throw new NotFoundError('Frånvaron');
  if (a.payroll_run_id) throw new ConflictError('Frånvaron är redan inräknad i en lönekörning');
  if (actor.role === 'employee' && (a.employee_id !== actor.employeeId || a.status !== 'requested')) throw new ValidationError('Du kan bara återta egna ansökningar som inte är hanterade');
  await sql`DELETE FROM absences WHERE id = ${id}`;
  await auditBy(sql, actor, 'delete', 'absence', id);
}

/** Semestersaldo per anställd för ett kalenderår */
export async function vacationBalances(companyId: number, year: number) {
  const emps = await sql<{ id: number; name: string; vacation_days: number }[]>`SELECT id, first_name || ' ' || last_name AS name, vacation_days FROM employees WHERE company_id = ${companyId} AND active ORDER BY last_name`;
  const list = await listAbsences(companyId, { status: 'approved', year });
  return emps.map((e) => {
    const taken = vacationDaysTaken(list.filter((a) => a.employee_id === e.id), year);
    const planned = vacationDaysTaken(list.filter((a) => a.employee_id === e.id && a.from > today()), year);
    return { ...e, taken: Math.round(taken * 10) / 10, planned: Math.round(planned * 10) / 10, left: Math.round((e.vacation_days - taken) * 10) / 10 };
  });
}

/**
 * För över godkänd frånvaro som avslutats före lönekörningens månad till lönespecarna (frånvaro i efterskott):
 * sjukavdrag, sjuklön och karensavdrag, semestertillägg samt löneavdrag för VAB, föräldraledighet och tjänstledighet.
 */
export async function applyToRun(actor: Actor, runId: number) {
  const [run] = await sql<{ status: string; period: string }[]>`SELECT status, period FROM payroll_runs WHERE id = ${runId} AND company_id = ${actor.companyId}`;
  if (!run) throw new NotFoundError('Lönekörningen');
  if (run.status !== 'draft') throw new ConflictError('Lönekörningen är redan bokförd');
  const firstOfPeriod = `${run.period}-01`;
  const slips = await sql<{ id: number; employee_id: number; items: unknown[]; monthly: number; hours: number; rule: string; paid_days: number; supplement: number | null }[]>`
    SELECT p.id, p.employee_id, p.items, e.monthly_salary::bigint AS monthly, e.hours_per_week::float8 AS hours, e.vacation_rule AS rule, e.vacation_days AS paid_days,
      a.vacation_supplement::float8 AS supplement
    FROM payslips p JOIN employees e ON e.id = p.employee_id LEFT JOIN collective_agreements a ON a.id = e.agreement_id WHERE p.run_id = ${runId}`;
  let n = 0;
  for (const s of slips) {
    const abs = await sql<{ id: number; kind: AbsenceKind; from: string; to: string; extent: number }[]>`
      SELECT id, kind, to_char(from_date,'YYYY-MM-DD') AS "from", to_char(to_date,'YYYY-MM-DD') AS "to", extent FROM absences
      WHERE employee_id = ${s.employee_id} AND status = 'approved' AND payroll_run_id IS NULL AND to_date < ${firstOfPeriod} ORDER BY from_date`;
    if (!abs.length) continue;
    const items: unknown[] = [];
    for (const a of abs) {
      const monthly = Number(s.monthly);
      if (a.kind === 'sick') {
        const [prev] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM absences WHERE employee_id = ${s.employee_id} AND kind = 'sick' AND id <> ${a.id}
          AND status = 'approved' AND to_date < ${a.from} AND to_date >= ${a.from}::date - 5`;
        items.push(...sickItems({ from: a.from, to: a.to, extent: a.extent, monthly, hoursPerWeek: s.hours, noKarens: prev.n > 0 }));
      } else if (a.kind === 'vacation' && s.rule === 'percent') {
        // Procentregeln: 12 % av förra årets semesterlönegrundande lön (bokförda lönespecar) per betald semesterdag
        const year = Number(a.from.slice(0, 4)) - 1;
        const [earned] = await sql<{ sum: number }[]>`SELECT COALESCE(SUM(p.gross_cash), 0)::bigint AS sum FROM payslips p JOIN payroll_runs r ON r.id = p.run_id
          WHERE p.employee_id = ${s.employee_id} AND r.status = 'booked' AND r.period LIKE ${year + '-%'}`;
        const days = workdays(a.from, a.to).length * (a.extent / 100);
        const v = percentRuleVacation({ earnedLastYear: Number(earned.sum), paidDays: s.paid_days || 25, daysTaken: days, monthly });
        if (v.pay) items.push({ type: 'salary', description: `Semesterlön ${String(days).replace('.', ',')} dagar ${a.from}–${a.to} (procentregeln, 12 % av ${year})`, amount: v.pay });
        if (v.deduction) items.push({ type: 'salary', description: `Avdrag lön under semester ${String(days).replace('.', ',')} dagar`, amount: -v.deduction });
      } else if (a.kind === 'vacation' && s.supplement != null) {
        // Sammalöneregeln enligt kollektivavtal: avtalets semestertillägg + 12 % av förra årets rörliga lön (OB, övertid, beredskap)
        const year = Number(a.from.slice(0, 4)) - 1;
        const [variable] = await sql<{ sum: number }[]>`SELECT COALESCE(SUM((it->>'amount')::bigint), 0)::bigint AS sum FROM payslips p JOIN payroll_runs r ON r.id = p.run_id, jsonb_array_elements(p.items) it
          WHERE p.employee_id = ${s.employee_id} AND r.status = 'booked' AND r.period LIKE ${year + '-%'} AND it->>'code' = 'agreement'`;
        const days = workdays(a.from, a.to).length * (a.extent / 100);
        const v = sameRuleVacation({ monthly, days, supplementPercent: s.supplement, variableLastYear: Number(variable.sum), paidDays: s.paid_days || 25 });
        const d = String(days).replace('.', ',');
        if (v.supplement) items.push({ type: 'salary', code: 'vacation', description: `Semestertillägg ${d} dagar ${a.from}–${a.to} (${String(s.supplement).replace('.', ',')} % per dag)`, amount: v.supplement });
        if (v.variable) items.push({ type: 'salary', code: 'vacation', description: `Semesterlön på rörliga lönedelar ${d} dagar (12 % av ${year})`, amount: v.variable });
      } else if (a.kind === 'vacation') items.push(...vacationItems({ from: a.from, to: a.to, monthly, extent: a.extent }));
      else items.push(...leaveItems({ kind: a.kind, from: a.from, to: a.to, extent: a.extent, monthly, hoursPerWeek: s.hours }));
    }
    await updatePayslip(actor, runId, s.id, { items: [...s.items, ...items] });
    await sql`UPDATE absences SET payroll_run_id = ${runId} WHERE id IN ${sql(abs.map((a) => a.id))}`;
    n += abs.length;
  }
  await auditBy(sql, actor, 'apply_absence', 'payroll_run', runId, { absences: n });
  return n;
}
