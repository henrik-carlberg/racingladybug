import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { agreementItems, collectumXml, type CollectumRow, foraCsv, HOUR_FIELDS, itp2AnnualSalary, PLAN_LABEL, salarySacrifice, type AgreementRules, type Hours, type PensionPlan } from '@/lib/payroll-agreements';
import type { Actor } from './actor';
import { parseAmount } from '@/lib/money';
import { getPayrollRun, updatePayslip } from './payroll';

export interface Agreement extends AgreementRules { id: number; name: string; fora_insurance_percent: number }
const COLS = sql`id, name, ob_evening::float8 AS ob_evening, ob_night::float8 AS ob_night, ob_weekend::float8 AS ob_weekend, ob_holiday::float8 AS ob_holiday,
  overtime_simple_divisor, overtime_qualified_divisor, oncall_weekday::float8 AS oncall_weekday, oncall_weekend::float8 AS oncall_weekend,
  vacation_supplement::float8 AS vacation_supplement, fora_insurance_percent::float8 AS fora_insurance_percent, travel_divisor`;

export async function listAgreements(companyId: number) {
  return [...await sql<Agreement[]>`SELECT ${COLS} FROM collective_agreements WHERE company_id = ${companyId} ORDER BY name`];
}

const MONEY = ['ob_evening', 'ob_night', 'ob_weekend', 'ob_holiday', 'oncall_weekday', 'oncall_weekend'] as const;
function parse(input: Record<string, string>) {
  const name = (input.name ?? '').trim().slice(0, 80);
  if (!name) throw new ValidationError('Ange avtalets namn');
  const f: Record<string, number | string> = { name };
  for (const k of MONEY) { const v = (input[k] ?? '').trim(); const o = v ? parseAmount(v) : 0; if (o == null) throw new ValidationError(`Ogiltigt belopp "${v}"`); f[k] = o; if ((f[k] as number) < 0) throw new ValidationError('Negativt belopp'); }
  for (const k of ['overtime_simple_divisor', 'overtime_qualified_divisor', 'travel_divisor'] as const) {
    const v = Number((input[k] ?? '').trim() || (k === 'overtime_simple_divisor' ? 94 : k === 'travel_divisor' ? 240 : 72));
    if (!Number.isInteger(v) || v < 0 || v > 400) throw new ValidationError('Delaren för övertid ska vara ett heltal, t.ex. 94 eller 72 (0 = ingen ersättning)');
    f[k] = v;
  }
  const pct = (k: string, def: number, max: number) => { const v = Number((input[k] ?? '').replace(',', '.').trim() || def); if (!(v >= 0 && v <= max)) throw new ValidationError('Ogiltig procentsats'); return v; };
  f.vacation_supplement = pct('vacation_supplement', 0.43, 5);
  f.fora_insurance_percent = pct('fora_insurance_percent', 0, 10);
  return f;
}

export async function saveAgreement(actor: Actor, id: number | null, input: Record<string, string>) {
  const f = parse(input);
  try {
    if (id) {
      const r = await sql`UPDATE collective_agreements SET ${sql(f)} WHERE id = ${id} AND company_id = ${actor.companyId} RETURNING id`;
      if (!r.length) throw new NotFoundError('Avtalet');
      await auditBy(sql, actor, 'update', 'agreement', id, f);
      return id;
    }
    const [r] = await sql<{ id: number }[]>`INSERT INTO collective_agreements ${sql({ ...f, company_id: actor.companyId })} RETURNING id`;
    await auditBy(sql, actor, 'create', 'agreement', r.id, f);
    return r.id;
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new ConflictError('Det finns redan ett avtal med det namnet');
    throw e;
  }
}

/** Timmar för OB, övertid och beredskap på en lönespec → lönerader enligt den anställdas avtal (ersätter tidigare avtalsrader) */
export async function applyHours(actor: Actor, runId: number, slipId: number, input: Record<string, string>) {
  const [s] = await sql<{ items: { code?: string }[]; monthly: number; agreement_id: number | null }[]>`
    SELECT p.items, e.monthly_salary::bigint AS monthly, e.agreement_id FROM payslips p JOIN employees e ON e.id = p.employee_id JOIN payroll_runs r ON r.id = p.run_id
    WHERE p.id = ${slipId} AND p.run_id = ${runId} AND r.company_id = ${actor.companyId}`;
  if (!s) throw new NotFoundError('Lönespecen');
  if (!s.agreement_id) throw new ValidationError('Den anställda har inget kollektivavtal – välj avtal på den anställda');
  const [a] = await sql<Agreement[]>`SELECT ${COLS} FROM collective_agreements WHERE id = ${s.agreement_id}`;
  const hours: Hours = {};
  for (const [k] of HOUR_FIELDS) {
    const v = Number((input[k] ?? '').replace(',', '.').trim() || 0);
    if (!(v >= 0 && v <= 400)) throw new ValidationError('Ogiltigt antal timmar');
    if (v) hours[k] = Math.round(v * 100) / 100;
  }
  const items = [...s.items.filter((i) => i.code !== 'agreement'), ...agreementItems(a, hours, Number(s.monthly))];
  await updatePayslip(actor, runId, slipId, { items });
  await sql`UPDATE payslips SET hours = ${sql.json(hours as never)} WHERE id = ${slipId}`;
  return items.length;
}

/** Pension och avtalsförsäkringar för en lönekörning, med underlag till Collectum och Fora */
export async function pensionReport(companyId: number, runId: number) {
  const run = await getPayrollRun(companyId, runId);
  const rows = await sql<{ employee_id: number; name: string; pnr: string; plan: PensionPlan; monthly: number; sacrifice: number; start: string | null; end: string | null; gross: number; pension: number; slp: number; insurance: number; prev_monthly: number | null }[]>`
    SELECT e.id AS employee_id, e.first_name || ' ' || e.last_name AS name, e.personal_number AS pnr, e.pension_plan AS plan, e.monthly_salary::bigint AS monthly, e.salary_sacrifice::bigint AS sacrifice,
      to_char(e.employment_start,'YYYY-MM-DD') AS start, to_char(e.employment_end,'YYYY-MM-DD') AS "end",
      p.gross_cash::bigint AS gross, p.pension::bigint AS pension, p.pension_tax::bigint AS slp, p.insurance::bigint AS insurance,
      (SELECT (it->>'amount')::bigint FROM payslips p2 JOIN payroll_runs r2 ON r2.id = p2.run_id, jsonb_array_elements(p2.items) it
        WHERE p2.employee_id = e.id AND r2.company_id = ${companyId} AND r2.period < ${run.period} AND it->>'description' = 'Månadslön' ORDER BY r2.period DESC LIMIT 1) AS prev_monthly
    FROM payslips p JOIN employees e ON e.id = p.employee_id WHERE p.run_id = ${runId} ORDER BY e.last_name, e.first_name`;
  const year = Number(run.period.slice(0, 4));
  return {
    run,
    rows: rows.map((r) => ({ ...r, gross: Number(r.gross), pension: Number(r.pension), slp: Number(r.slp), insurance: Number(r.insurance), planLabel: PLAN_LABEL[r.plan],
      sacrificeWarning: Number(r.sacrifice) ? salarySacrifice({ amount: Number(r.sacrifice), monthlyBefore: Number(r.monthly), year }).warning : '' })),
  };
}

export async function collectumFile(companyId: number, runId: number) {
  const { run, rows } = await pensionReport(companyId, runId);
  const [c] = await sql<{ orgnr: string }[]>`SELECT orgnr FROM companies WHERE id = ${companyId}`;
  const inMonth = (d: string | null) => !!d && d.slice(0, 7) === run.period;
  const events = rows.filter((r) => r.plan === 'itp1' || r.plan === 'itp2').flatMap((r): CollectumRow[] => {
    const plan = r.plan as 'itp1' | 'itp2';
    const base = { pnr: r.pnr, name: r.name, plan, annualSalary: itp2AnnualSalary(Number(r.monthly)) };
    if (inMonth(r.end)) return [{ ...base, event: 'avanmalan', date: r.end! }];
    if (inMonth(r.start) || r.prev_monthly == null) return [{ ...base, event: 'nyanmalan', date: r.start && inMonth(r.start) ? r.start : `${run.period}-01` }];
    if (plan === 'itp2' && Number(r.prev_monthly) !== Number(r.monthly)) return [{ ...base, event: 'loneandring', date: `${run.period}-01` }];
    return [];
  });
  return { filename: `collectum_${run.period}.xml`, content: collectumXml({ orgnr: c.orgnr, period: run.period, rows: events }), count: events.length };
}

export async function foraFile(companyId: number, runId: number) {
  const { run, rows } = await pensionReport(companyId, runId);
  const [c] = await sql<{ orgnr: string }[]>`SELECT orgnr FROM companies WHERE id = ${companyId}`;
  const saf = rows.filter((r) => r.plan === 'saf_lo');
  return { filename: `fora_${run.period}.csv`, content: foraCsv({ orgnr: c.orgnr, period: run.period, rows: saf.map((r) => ({ pnr: r.pnr, name: r.name, salary: r.gross })) }), count: saf.length };
}
