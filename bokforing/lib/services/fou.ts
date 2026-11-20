import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { deduction, deductionLines, type FouSlip } from '@/lib/fou';
import type { Actor } from './actor';

async function run(companyId: number, runId: number) {
  const [r] = await sql<{ id: number; period: string; status: string; payment_date: string }[]>`SELECT id, period, status, to_char(payment_date,'YYYY-MM-DD') AS payment_date FROM payroll_runs WHERE id = ${runId} AND company_id = ${companyId}`;
  if (!r) throw new NotFoundError('Lönekörningen');
  return r;
}

export async function overview(companyId: number, runId: number) {
  const r = await run(companyId, runId);
  const slips = await sql<(FouSlip & { description: string })[]>`SELECT p.id, e.first_name || ' ' || e.last_name AS name, (p.gross_cash + p.benefits)::float8 AS base, p.employer_fee_rate::float8 AS "feeRate",
      COALESCE(f.fou_hours, 0)::float8 AS "fouHours", COALESCE(f.total_hours, 0)::float8 AS "totalHours", COALESCE(f.description, '') AS description
    FROM payslips p JOIN employees e ON e.id = p.employee_id LEFT JOIN fou_hours f ON f.payslip_id = p.id WHERE p.run_id = ${runId} ORDER BY e.first_name, e.last_name`;
  const d = deduction(slips);
  const [booked] = await sql<{ amount: number; voucher_id: number | null }[]>`SELECT amount::float8 AS amount, voucher_id FROM fou_deductions WHERE run_id = ${runId}`;
  return { run: r, ...d, rows: d.rows.map((x, i) => ({ ...x, description: slips[i].description })), booked: booked ?? null };
}

/** Tid i FoU-arbete för en lönespec (underlaget som ska kunna visas för Skatteverket) */
export async function setHours(actor: Actor, runId: number, payslipId: number, input: Record<string, unknown>) {
  const r = await run(actor.companyId, runId);
  const [b] = await sql`SELECT 1 FROM fou_deductions WHERE run_id = ${runId}`;
  if (b) throw new ConflictError('Avdraget för lönekörningen är redan bokfört');
  const [p] = await sql`SELECT 1 FROM payslips WHERE id = ${payslipId} AND run_id = ${r.id}`;
  if (!p) throw new NotFoundError('Lönespecen');
  const h = (v: unknown, l: string) => { const n = Number(String(v ?? '').replace(',', '.') || '0'); if (!(n >= 0 && n <= 744)) throw new ValidationError(`Ogiltigt antal timmar: ${l}`); return n; };
  const fou = h(input.fou_hours, 'FoU'), total = h(input.total_hours, 'arbetstid');
  if (fou > total) throw new ValidationError('FoU-tiden kan inte vara mer än den totala arbetstiden');
  await sql`INSERT INTO fou_hours (payslip_id, company_id, fou_hours, total_hours, description) VALUES (${payslipId}, ${actor.companyId}, ${fou}, ${total}, ${String(input.description ?? '').slice(0, 300)})
    ON CONFLICT (payslip_id) DO UPDATE SET fou_hours = EXCLUDED.fou_hours, total_hours = EXCLUDED.total_hours, description = EXCLUDED.description`;
  await auditBy(sql, actor, 'fou_hours', 'payslip', payslipId, { fou, total });
}

/** Bokför månadens avdrag (minskar arbetsgivaravgifterna) – en gång per lönekörning, efter att lönen är bokförd */
export async function book(actor: Actor, runId: number) {
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(113001, ${runId})`;
    const o = await overview(actor.companyId, runId);
    if (o.run.status !== 'booked') throw new ValidationError('Bokför lönekörningen först');
    if (o.booked) throw new ConflictError('Avdraget är redan bokfört');
    if (!o.total) throw new ValidationError('Ingen anställd uppfyller kraven för forskningsavdrag i perioden');
    const v = await createVoucher(tx, { actor, date: o.run.payment_date, description: `Forskningsavdrag (FoU) arbetsgivaravgifter ${o.run.period}`, lines: fromSigned(deductionLines(o.total)), sourceType: 'fou_deduction', sourceId: runId });
    await tx`INSERT INTO fou_deductions ${tx({ run_id: runId, company_id: actor.companyId, base: o.base, amount: o.total, voucher_id: v.id, created_by: actor.userId })}`;
    await auditBy(tx, actor, 'fou_deduction', 'payroll_run', runId, { amount: o.total });
    return o.total;
  });
}
