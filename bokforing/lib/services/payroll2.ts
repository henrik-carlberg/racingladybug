import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { today } from '@/lib/format';
import { BENEFITS, checkBenefit, isBenefitKind } from '@/lib/benefits';
import { dailyFlex, payoutAmount } from '@/lib/flex';
import type { Actor } from './actor';
import { date, int, str } from './input';
import { updatePayslip } from './payroll';

const BENEFIT_ACCOUNT = 7690; // Övriga personalkostnader (skattefria förmåner)

async function draftSlip(companyId: number, runId: number, employeeId: number) {
  const [run] = await sql<{ status: string }[]>`SELECT status FROM payroll_runs WHERE id = ${runId} AND company_id = ${companyId}`;
  if (!run || run.status !== 'draft') throw new ValidationError('Välj en lönekörning som inte är bokförd');
  const [slip] = await sql<{ id: number; items: unknown[] }[]>`SELECT id, items FROM payslips WHERE run_id = ${runId} AND employee_id = ${employeeId}`;
  if (!slip) throw new ValidationError('Den anställda finns inte i lönekörningen');
  return slip;
}

// ---------- Förmåner ----------
export async function benefitUsage(companyId: number, year: number) {
  const emps = await sql<{ id: number; name: string }[]>`SELECT id, first_name || ' ' || last_name AS name FROM employees WHERE company_id = ${companyId} AND active ORDER BY last_name`;
  const used = await sql<{ employee_id: number; kind: string; sum: number }[]>`SELECT employee_id, kind, SUM(amount)::float8 AS sum FROM benefit_payments
    WHERE company_id = ${companyId} AND extract(year FROM date) = ${year} GROUP BY employee_id, kind`;
  const history = await sql<{ id: number; employee: string; kind: string; date: string; amount: number; description: string; run: string | null }[]>`
    SELECT b.id, e.first_name || ' ' || e.last_name AS employee, b.kind, to_char(b.date,'YYYY-MM-DD') AS date, b.amount::float8 AS amount, b.description, r.period AS run
    FROM benefit_payments b JOIN employees e ON e.id = b.employee_id LEFT JOIN payroll_runs r ON r.id = b.payroll_run_id
    WHERE b.company_id = ${companyId} AND extract(year FROM b.date) = ${year} ORDER BY b.date DESC, b.id DESC LIMIT 200`;
  return { emps: emps.map((e) => ({ ...e, used: Object.fromEntries(used.filter((u) => u.employee_id === e.id).map((u) => [u.kind, u.sum])) as Record<string, number> })), history: [...history] };
}

/** Skattefri förmån som betalas ut med lönen (inom årets tak) */
export async function registerBenefit(actor: Actor, input: Record<string, unknown>) {
  const kind = str(input, 'kind');
  if (!isBenefitKind(kind)) throw new ValidationError('Välj förmån');
  const emp = int(input, 'employee_id', 'Anställd'), amount = int(input, 'amount', 'Belopp'), d = date(input, 'date', 'Datum');
  const runId = int(input, 'run_id', 'Lönekörning');
  const [e] = await sql<{ name: string }[]>`SELECT first_name || ' ' || last_name AS name FROM employees WHERE id = ${emp} AND company_id = ${actor.companyId}`;
  if (!e) throw new NotFoundError('Den anställda');
  const slip = await draftSlip(actor.companyId, runId, emp);
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${8_300_000 + emp})`;
    const [{ used }] = await tx<{ used: number }[]>`SELECT COALESCE(SUM(amount), 0)::float8 AS used FROM benefit_payments WHERE company_id = ${actor.companyId} AND employee_id = ${emp}
      AND kind = ${kind} AND extract(year FROM date) = ${Number(d.slice(0, 4))}`;
    const c = checkBenefit(kind, used, amount);
    if (!c.ok) throw new ValidationError(c.message);
    const [b] = await tx<{ id: number }[]>`INSERT INTO benefit_payments (company_id, employee_id, kind, date, amount, description, payroll_run_id, created_by)
      VALUES (${actor.companyId}, ${emp}, ${kind}, ${d}, ${amount}, ${str(input, 'description', { max: 200 })}, ${runId}, ${actor.userId}) RETURNING id`;
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${BENEFIT_ACCOUNT}, 'Övriga personalkostnader') ON CONFLICT DO NOTHING`;
    await auditBy(tx, actor, 'benefit', 'employee', emp, { kind, amount, run: runId });
    return { id: b.id, left: c.left, slip };
  }).then(async (r) => {
    // Raden läggs på lönebeskedet som skattefri ersättning
    await updatePayslip(actor, runId, r.slip.id, { items: [...r.slip.items, { type: 'reimbursement', description: `${BENEFITS[kind].label}${str(input, 'description') ? ': ' + str(input, 'description') : ''}`, amount, account: BENEFIT_ACCOUNT }] });
    return { id: r.id, left: r.left, employee: e.name };
  });
}

// ---------- Flextid ----------
export async function setFlex(actor: Actor, employeeId: number, start: string | null) {
  const r = await sql`UPDATE employees SET flex_start = ${start} WHERE id = ${employeeId} AND company_id = ${actor.companyId} RETURNING id`;
  if (!r.length) throw new NotFoundError('Den anställda');
  await auditBy(sql, actor, 'flex', 'employee', employeeId, { start });
}

export async function flexFor(companyId: number, employeeId: number, until = today()) {
  const [e] = await sql<{ name: string; start: string | null; monthly: number }[]>`SELECT first_name || ' ' || last_name AS name, to_char(flex_start,'YYYY-MM-DD') AS start, monthly_salary::float8 AS monthly
    FROM employees WHERE id = ${employeeId} AND company_id = ${companyId}`;
  if (!e) throw new NotFoundError('Den anställda');
  if (!e.start) return { ...e, days: [], adjustments: [], balance: 0, auto: 0 };
  const shifts = await sql<{ start: string; end: string }[]>`SELECT starts_at AS start, ends_at AS end FROM shifts WHERE company_id = ${companyId} AND employee_id = ${employeeId} AND starts_at >= ${e.start}::date`;
  const logs = await sql<{ start: string; end: string }[]>`SELECT check_in AS start, check_out AS end FROM staff_log WHERE company_id = ${companyId} AND employee_id = ${employeeId}
    AND check_in >= ${e.start}::date AND check_out IS NOT NULL`;
  const days = dailyFlex(shifts.map((s) => ({ start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString() })),
    logs.map((l) => ({ start: new Date(l.start).toISOString(), end: new Date(l.end).toISOString() })), until);
  const adjustments = [...await sql<{ id: number; date: string; minutes: number; kind: string; note: string }[]>`SELECT id, to_char(date,'YYYY-MM-DD') AS date, minutes, kind, note
    FROM flex_adjustments WHERE company_id = ${companyId} AND employee_id = ${employeeId} ORDER BY date DESC, id DESC`];
  const auto = days.reduce((s, d) => s + d.diff, 0);
  return { ...e, days, adjustments, auto, balance: auto + adjustments.reduce((s, a) => s + a.minutes, 0) };
}

export async function flexOverview(companyId: number) {
  const emps = await sql<{ id: number }[]>`SELECT id FROM employees WHERE company_id = ${companyId} AND active AND flex_start IS NOT NULL ORDER BY last_name`;
  return Promise.all(emps.map(async (e) => ({ id: e.id, ...(await flexFor(companyId, e.id)) })));
}

/** Rättning eller ledighet (kompledigt) i tidbanken */
export async function adjustFlex(actor: Actor, employeeId: number, input: Record<string, unknown>) {
  const kind = str(input, 'kind') === 'leave' ? 'leave' : 'adjust';
  const minutes = Math.round(Number(String(input.hours ?? '').replace(',', '.')) * 60);
  if (!Number.isFinite(minutes) || minutes === 0 || Math.abs(minutes) > 400 * 60) throw new ValidationError('Ange antal timmar');
  const note = str(input, 'note', { required: true, label: 'Kommentar', max: 300 });
  await flexFor(actor.companyId, employeeId);
  await sql`INSERT INTO flex_adjustments (company_id, employee_id, date, minutes, kind, note, created_by) VALUES (${actor.companyId}, ${employeeId}, ${date(input, 'date', 'Datum', false) || today()},
    ${kind === 'leave' ? -Math.abs(minutes) : minutes}, ${kind}, ${note}, ${actor.userId})`;
  await auditBy(sql, actor, 'flex_adjust', 'employee', employeeId, { minutes, kind });
}

/** Utbetalning av sparad tid med lönen (timlön = månadslön/165) */
export async function payoutFlex(actor: Actor, employeeId: number, input: Record<string, unknown>) {
  const f = await flexFor(actor.companyId, employeeId);
  const minutes = Math.round(Number(String(input.hours ?? '').replace(',', '.')) * 60);
  if (!Number.isFinite(minutes) || minutes <= 0) throw new ValidationError('Ange antal timmar att betala ut');
  if (minutes > f.balance) throw new ConflictError('Det finns inte så mycket sparad tid');
  const runId = int(input, 'run_id', 'Lönekörning');
  const slip = await draftSlip(actor.companyId, runId, employeeId);
  const amount = payoutAmount(minutes, f.monthly);
  await sql`INSERT INTO flex_adjustments (company_id, employee_id, date, minutes, kind, note, payroll_run_id, created_by) VALUES (${actor.companyId}, ${employeeId}, ${today()}, ${-minutes}, 'payout',
    'Utbetald med lönen', ${runId}, ${actor.userId})`;
  await updatePayslip(actor, runId, slip.id, { items: [...slip.items, { type: 'salary', description: `Utbetalning flextid ${(minutes / 60).toLocaleString('sv-SE')} h`, amount }] });
  await auditBy(sql, actor, 'flex_payout', 'employee', employeeId, { minutes, amount });
  return amount;
}
