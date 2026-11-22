import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { recomputeSlip } from '@/lib/server/payroll';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { GARNISHMENT_ACCOUNT, deduction, item, payLines } from '@/lib/garnishment';
import type { PayItem } from '@/lib/payroll';
import type { Actor } from './actor';
import { date, int, str } from './input';

const kronor = (v: unknown, label: string, zero = false) => { const n = parseAmount(String(v ?? '').trim() || (zero ? '0' : '')); if (n == null || n < 0 || (!zero && !n)) throw new ValidationError(`Ange ${label} i kronor`); return n; };

export async function overview(companyId: number) {
  const decisions = await sql<{ id: number; employee_id: number; name: string; case_no: string; monthly_amount: number; reserved_amount: number; valid_from: string; ended_on: string | null; applied: number[]; withheld: number; unpaid: number }[]>`
    SELECT g.id, g.employee_id, e.first_name || ' ' || e.last_name AS name, g.case_no, g.monthly_amount::float8 AS monthly_amount, g.reserved_amount::float8 AS reserved_amount,
      to_char(g.valid_from,'YYYY-MM-DD') AS valid_from, to_char(g.ended_on,'YYYY-MM-DD') AS ended_on,
      ARRAY(SELECT d.run_id FROM garnishment_deductions d WHERE d.garnishment_id = g.id) AS applied,
      COALESCE((SELECT SUM(d.amount) FROM garnishment_deductions d JOIN payroll_runs r ON r.id = d.run_id WHERE d.garnishment_id = g.id AND r.status = 'booked'), 0)::float8 AS withheld,
      COALESCE((SELECT SUM(d.amount) FROM garnishment_deductions d JOIN payroll_runs r ON r.id = d.run_id WHERE d.garnishment_id = g.id AND r.status = 'booked' AND d.paid_voucher_id IS NULL), 0)::float8 AS unpaid
    FROM wage_garnishments g JOIN employees e ON e.id = g.employee_id WHERE g.company_id = ${companyId} ORDER BY g.ended_on NULLS FIRST, g.valid_from DESC`;
  const runs = await sql<{ id: number; period: string }[]>`SELECT id, period FROM payroll_runs WHERE company_id = ${companyId} AND status = 'draft' ORDER BY period`;
  const employees = await sql<{ id: number; name: string }[]>`SELECT id, first_name || ' ' || last_name AS name FROM employees WHERE company_id = ${companyId} AND active ORDER BY last_name, first_name`;
  const months = await sql<{ period: string; amount: number; paid: boolean }[]>`SELECT r.period, SUM(d.amount)::float8 AS amount, bool_and(d.paid_voucher_id IS NOT NULL OR d.amount = 0) AS paid
    FROM garnishment_deductions d JOIN payroll_runs r ON r.id = d.run_id JOIN wage_garnishments g ON g.id = d.garnishment_id
    WHERE g.company_id = ${companyId} AND r.status = 'booked' GROUP BY r.period ORDER BY r.period DESC`;
  return { decisions, runs, employees, months, unpaid: decisions.reduce((s, d) => s + d.unpaid, 0) };
}

export async function addDecision(actor: Actor, input: Record<string, unknown>) {
  const employeeId = int(input, 'employee_id', 'Anställd');
  const [e] = await sql`SELECT 1 FROM employees WHERE id = ${employeeId} AND company_id = ${actor.companyId}`;
  if (!e) throw new NotFoundError('Den anställda');
  const [r] = await sql<{ id: number }[]>`INSERT INTO wage_garnishments ${sql({ company_id: actor.companyId, employee_id: employeeId, case_no: str(input, 'case_no', { required: true, label: 'Målnummer', max: 60 }),
    monthly_amount: kronor(input.monthly_amount, 'beloppet att dra per månad'), reserved_amount: kronor(input.reserved_amount, 'förbehållsbeloppet', true),
    valid_from: date(input, 'valid_from', 'Gäller från'), created_by: actor.userId })} RETURNING id`;
  await auditBy(sql, actor, 'create', 'wage_garnishment', r.id);
}

/** Lägger in utmätningen på den anställdas lönespec i en lönekörning som inte är bokförd */
export async function applyToRun(actor: Actor, id: number, input: Record<string, unknown>) {
  const runId = int(input, 'run_id', 'Lönekörning');
  return sql.begin(async (tx) => {
    const [g] = await tx<{ employee_id: number; case_no: string; monthly: number; reserved: number; from: string; ended: string | null }[]>`SELECT employee_id, case_no, monthly_amount::float8 AS monthly,
      reserved_amount::float8 AS reserved, to_char(valid_from,'YYYY-MM-DD') AS "from", to_char(ended_on,'YYYY-MM-DD') AS ended FROM wage_garnishments WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!g) throw new NotFoundError('Beslutet');
    const [run] = await tx<{ status: string; payment_date: string }[]>`SELECT status, to_char(payment_date,'YYYY-MM-DD') AS payment_date FROM payroll_runs WHERE id = ${runId} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!run) throw new NotFoundError('Lönekörningen');
    if (run.status !== 'draft') throw new ConflictError('Lönekörningen är redan bokförd');
    if (run.payment_date < g.from || (g.ended && run.payment_date > g.ended)) throw new ValidationError('Utbetalningsdagen ligger utanför beslutets giltighetstid');
    const [dup] = await tx`SELECT 1 FROM garnishment_deductions WHERE garnishment_id = ${id} AND run_id = ${runId}`;
    if (dup) throw new ConflictError('Utmätningen är redan med i lönekörningen');
    const [slip] = await tx<{ id: number; items: PayItem[] }[]>`SELECT id, items FROM payslips WHERE run_id = ${runId} AND employee_id = ${g.employee_id} FOR UPDATE`;
    if (!slip) throw new ValidationError('Den anställda finns inte med i lönekörningen');
    const calc = await recomputeSlip(tx, slip.id);
    const amount = deduction({ netPay: calc.netPay, monthly: g.monthly, reserved: g.reserved });
    if (amount) {
      await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${GARNISHMENT_ACCOUNT}, 'Utmätning i lön m.m.') ON CONFLICT DO NOTHING`;
      await tx`UPDATE payslips SET items = ${tx.json([...slip.items, item(amount, g.case_no)] as never)} WHERE id = ${slip.id}`;
      await recomputeSlip(tx, slip.id);
    }
    await tx`INSERT INTO garnishment_deductions ${tx({ garnishment_id: id, run_id: runId, amount })}`;
    await auditBy(tx, actor, 'garnishment_run', 'wage_garnishment', id, { runId, amount });
    return { amount, netPay: calc.netPay };
  });
}

/** Innehållna belopp i bokförda lönekörningar betalas in till Kronofogden */
export async function payToKfm(actor: Actor, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Betalningsdag', false) || today();
  return sql.begin(async (tx) => {
    const rows = await tx<{ id: number; amount: number }[]>`SELECT d.id, d.amount::float8 AS amount FROM garnishment_deductions d JOIN wage_garnishments g ON g.id = d.garnishment_id JOIN payroll_runs r ON r.id = d.run_id
      WHERE g.company_id = ${actor.companyId} AND r.status = 'booked' AND d.paid_voucher_id IS NULL AND d.amount > 0 FOR UPDATE OF d`;
    const total = rows.reduce((s, r) => s + r.amount, 0);
    if (!total) throw new ValidationError('Det finns inga innehållna belopp att betala in');
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${GARNISHMENT_ACCOUNT}, 'Utmätning i lön m.m.') ON CONFLICT DO NOTHING`;
    const v = await createVoucher(tx, { actor, date: d, description: 'Inbetalning av löneutmätning till Kronofogden', lines: fromSigned(payLines(total)), sourceType: 'garnishment' });
    await tx`UPDATE garnishment_deductions SET paid_voucher_id = ${v.id} WHERE id IN ${tx(rows.map((r) => r.id))}`;
    await auditBy(tx, actor, 'garnishment_paid', 'company', actor.companyId, { total });
    return total;
  });
}

export async function endDecision(actor: Actor, id: number, input: Record<string, unknown>) {
  const d = date(input, 'ended_on', 'Upphör');
  const r = await sql`UPDATE wage_garnishments SET ended_on = ${d} WHERE id = ${id} AND company_id = ${actor.companyId} AND ended_on IS NULL AND valid_from <= ${d}`;
  if (!r.count) throw new ValidationError('Beslutet finns inte, har redan upphört eller börjar efter datumet');
  await auditBy(sql, actor, 'garnishment_end', 'wage_garnishment', id, { ended_on: d });
}
