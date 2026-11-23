import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { employerFee } from '@/lib/payroll';
import { ACCRUED_FEES, ACCRUED_SALARY, FEES, SALARY, accrualLines, lastDay, noticeMonths, obligation, severanceCalc } from '@/lib/terminations';
import type { Actor } from './actor';
import { date, int } from './input';

const feeRateFor = (personalNumber: string, override: number | null, d: string) => {
  const birthYear = Number(String(personalNumber).replace(/\D/g, '').slice(0, 4)) || 1980;
  return employerFee(100000, birthYear, d, override).effectiveRate;
};

export async function overview(companyId: number) {
  const list = await sql<{ id: number; employee_id: number; name: string; monthly_salary: number; personal_number: string; fee_override: number | null; employment_start: string | null; initiated_by: 'employer' | 'employee'; notice_date: string; notice_months: number; last_day: string; garden_leave: boolean; severance: number; severance_tax_pct: number; accrued: number; status: string }[]>`
    SELECT t.id, t.employee_id, e.first_name || ' ' || e.last_name AS name, e.monthly_salary::float8 AS monthly_salary, e.personal_number, e.fee_override::float8 AS fee_override, to_char(e.employment_start,'YYYY-MM-DD') AS employment_start,
      t.initiated_by, to_char(t.notice_date,'YYYY-MM-DD') AS notice_date, t.notice_months, to_char(t.last_day,'YYYY-MM-DD') AS last_day, t.garden_leave, t.severance::float8 AS severance, t.severance_tax_pct::float8 AS severance_tax_pct, t.accrued::float8 AS accrued, t.status
    FROM terminations t JOIN employees e ON e.id = t.employee_id WHERE t.company_id = ${companyId} ORDER BY t.status, t.last_day`;
  const employees = await sql<{ id: number; name: string; employment_start: string | null }[]>`SELECT e.id, e.first_name || ' ' || e.last_name AS name, to_char(e.employment_start,'YYYY-MM-DD') AS employment_start FROM employees e
    WHERE e.company_id = ${companyId} AND e.active AND NOT EXISTS (SELECT 1 FROM terminations t WHERE t.employee_id = e.id) ORDER BY 2`;
  return {
    employees,
    terminations: list.map((x) => {
      const rate = feeRateFor(x.personal_number, x.fee_override, x.last_day);
      return { ...x, feeRate: rate, severanceCalc: severanceCalc(x.severance, x.severance_tax_pct, rate), obligation: obligation({ monthlySalary: x.monthly_salary, noticeMonths: x.notice_months, gardenLeave: x.garden_leave, severance: x.severance, feeRate: rate }) };
    }),
  };
}

/** Uppsägning: uppsägningstiden räknas fram enligt LAS (kan ändras om kollektivavtal eller avtal ger längre tid) */
export async function terminate(actor: Actor, input: Record<string, unknown>) {
  const employeeId = int(input, 'employee_id', 'Anställd');
  const [e] = await sql<{ start: string | null }[]>`SELECT to_char(employment_start,'YYYY-MM-DD') AS start FROM employees WHERE id = ${employeeId} AND company_id = ${actor.companyId} AND active`;
  if (!e) throw new NotFoundError('Den anställda');
  const by = input.initiated_by === 'employee' ? 'employee' : 'employer';
  const d = date(input, 'notice_date', 'Uppsägningsdag');
  const custom = String(input.notice_months ?? '').trim();
  const m = custom ? Number(custom) : noticeMonths(by, e.start, d);
  if (!Number.isInteger(m) || m < 0 || m > 24) throw new ValidationError('Ogiltig uppsägningstid');
  if (custom && by === 'employer' && m < noticeMonths(by, e.start, d)) throw new ValidationError(`Uppsägningstiden får inte vara kortare än lagens ${noticeMonths(by, e.start, d)} månader`);
  const severance = String(input.severance ?? '').trim() ? parseAmount(String(input.severance)) : 0;
  if (severance == null || severance < 0) throw new ValidationError('Ogiltigt avgångsvederlag');
  const tax = Number(String(input.severance_tax_pct ?? '30').replace(',', '.') || '30');
  if (!Number.isFinite(tax) || tax < 0 || tax > 100) throw new ValidationError('Ogiltig skattesats');
  try {
    const [r] = await sql<{ id: number }[]>`INSERT INTO terminations ${sql({ company_id: actor.companyId, employee_id: employeeId, initiated_by: by, notice_date: d, notice_months: m, last_day: lastDay(d, m),
      garden_leave: input.garden_leave === 'on', severance, severance_tax_pct: tax, created_by: actor.userId })} RETURNING id`;
    await auditBy(sql, actor, 'termination', 'employee', employeeId, { by, months: m, severance });
    return { id: r.id, months: m, lastDay: lastDay(d, m) };
  } catch (x) { if (String((x as Error).message).includes('terminations_employee_id_key')) throw new ConflictError('Den anställda är redan uppsagd'); throw x; }
}

/** Skulden för arbetsbefriad uppsägningstid och avgångsvederlag bokförs (t.ex. i bokslutet) */
export async function accrue(actor: Actor, id: number, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum', false) || today();
  return sql.begin(async (tx) => {
    const [t] = await tx<{ employee_id: number; monthly_salary: number; notice_months: number; garden_leave: boolean; severance: number; accrued: number; personal_number: string; fee_override: number | null; last_day: string; name: string }[]>`
      SELECT t.employee_id, e.monthly_salary::float8 AS monthly_salary, t.notice_months, t.garden_leave, t.severance::float8 AS severance, t.accrued::float8 AS accrued, e.personal_number, e.fee_override::float8 AS fee_override,
        to_char(t.last_day,'YYYY-MM-DD') AS last_day, e.first_name || ' ' || e.last_name AS name
      FROM terminations t JOIN employees e ON e.id = t.employee_id WHERE t.id = ${id} AND t.company_id = ${actor.companyId} FOR UPDATE OF t`;
    if (!t) throw new NotFoundError('Uppsägningen');
    if (t.accrued) throw new ConflictError('Skulden är redan bokförd');
    const o = obligation({ monthlySalary: t.monthly_salary, noticeMonths: t.notice_months, gardenLeave: t.garden_leave, severance: t.severance, feeRate: feeRateFor(t.personal_number, t.fee_override, t.last_day) });
    if (!o.total) throw new ValidationError('Det finns ingen skuld att reservera (den anställda arbetar under uppsägningstiden och inget avgångsvederlag)');
    for (const [n, name] of [[SALARY, 'Löner till tjänstemän'], [FEES, 'Lagstadgade sociala avgifter'], [ACCRUED_SALARY, 'Upplupna löner'], [ACCRUED_FEES, 'Upplupna lagstadgade sociala avgifter']] as const)
      await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${n}, ${name}) ON CONFLICT DO NOTHING`;
    const v = await createVoucher(tx, { actor, date: d, description: `Uppsägning ${t.name}: skuld för uppsägningslön och avgångsvederlag`, lines: fromSigned(accrualLines(o.salary, o.fee)), sourceType: 'termination', sourceId: id });
    await tx`UPDATE terminations SET accrued = ${o.total}, accrual_voucher_id = ${v.id} WHERE id = ${id}`;
    return o;
  });
}

/** Anställningen avslutas på sista dagen; en bokförd skuld löses upp när lönerna betalas ut i lönekörningarna */
export async function end(actor: Actor, id: number) {
  return sql.begin(async (tx) => {
    const [t] = await tx<{ employee_id: number; last_day: string; accrued: number; accrual_voucher_id: number | null; status: string; name: string }[]>`SELECT t.employee_id, to_char(t.last_day,'YYYY-MM-DD') AS last_day, t.accrued::float8 AS accrued,
      t.accrual_voucher_id, t.status, e.first_name || ' ' || e.last_name AS name FROM terminations t JOIN employees e ON e.id = t.employee_id WHERE t.id = ${id} AND t.company_id = ${actor.companyId} FOR UPDATE OF t`;
    if (!t) throw new NotFoundError('Uppsägningen');
    if (t.status === 'ended') throw new ConflictError('Anställningen är redan avslutad');
    let releaseId: number | null = null;
    if (t.accrued && t.accrual_voucher_id) {
      const lines = await tx<{ account: number; amount: number }[]>`SELECT account_number AS account, SUM(debit - credit)::float8 AS amount FROM voucher_lines WHERE voucher_id = ${t.accrual_voucher_id} GROUP BY account_number`;
      releaseId = (await createVoucher(tx, { actor, date: t.last_day > today() ? today() : t.last_day, description: `Uppsägning ${t.name}: upplöst skuld (lönerna är utbetalda i lönekörningarna)`, lines: fromSigned(lines.map((l) => ({ account: l.account, amount: -l.amount }))), sourceType: 'termination', sourceId: id })).id;
    }
    await tx`UPDATE employees SET employment_end = ${t.last_day}, active = false WHERE id = ${t.employee_id} AND company_id = ${actor.companyId}`;
    await tx`UPDATE terminations SET status = 'ended', release_voucher_id = ${releaseId} WHERE id = ${id}`;
    await auditBy(tx, actor, 'termination_ended', 'employee', t.employee_id, { last_day: t.last_day });
    return t.last_day;
  });
}
