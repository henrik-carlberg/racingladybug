import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { claimLines, compensation, INCOME, RECEIVABLE, sickPayOf } from '@/lib/sick-pay';
import type { Actor } from './actor';

/** Årets sjuklönekostnad (sjuklön med arbetsgivaravgifter) och totala lönekostnad från bokförda lönekörningar, per månad */
export async function year(companyId: number, y: number) {
  const slips = await sql<{ period: string; items: { description: string; amount: number }[]; gross: number; fee: number; rate: number }[]>`
    SELECT r.period, p.items, (p.gross_cash + p.benefits)::float8 AS gross, p.employer_fee::float8 AS fee, p.employer_fee_rate::float8 AS rate
    FROM payslips p JOIN payroll_runs r ON r.id = p.run_id WHERE r.company_id = ${companyId} AND r.status = 'booked' AND r.period LIKE ${`${y}-%`}`;
  const months = new Map<string, { sickPay: number; sickCost: number; totalCost: number }>();
  for (const s of slips) {
    const m = months.get(s.period) ?? { sickPay: 0, sickCost: 0, totalCost: 0 };
    const sp = sickPayOf(s.items ?? []);
    m.sickPay += sp; m.sickCost += Math.round(sp * (1 + s.rate / 100)); m.totalCost += s.gross + s.fee;
    months.set(s.period, m);
  }
  const rows = [...months].sort(([a], [b]) => a.localeCompare(b)).map(([period, v]) => ({ period, ...v }));
  const sickCost = rows.reduce((t, r) => t + r.sickCost, 0), totalCost = rows.reduce((t, r) => t + r.totalCost, 0);
  const [c] = await sql<{ amount: number; voucher_id: number | null }[]>`SELECT amount::float8 AS amount, voucher_id FROM sick_pay_claims WHERE company_id = ${companyId} AND year = ${y}`;
  const comp = compensation(sickCost, totalCost);
  return { year: y, months: rows, sickCost, totalCost, ratio: comp.ratio, amount: comp.amount, bands: comp.rows, claim: c ?? null };
}

/** Bokför den förväntade ersättningen som fordran på Försäkringskassan per årets sista dag */
export async function bookClaim(actor: Actor, y: number) {
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new ValidationError('Ogiltigt år');
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(118001, ${actor.companyId})`;
    const r = await year(actor.companyId, y);
    if (r.claim) throw new ConflictError('Ersättningen för året är redan bokförd');
    if (!r.amount) throw new ValidationError('Sjuklönekostnaden är för låg för ersättning från högkostnadsskyddet');
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${RECEIVABLE}, 'Fordran på Försäkringskassan'), (${actor.companyId}, ${INCOME}, 'Övriga ersättningar och intäkter') ON CONFLICT DO NOTHING`;
    const v = await createVoucher(tx, { actor, date: `${y}-12-31`, description: `Högkostnadsskydd för sjuklön ${y}`, lines: fromSigned(claimLines(r.amount)), sourceType: 'sick_pay_claim' });
    await tx`INSERT INTO sick_pay_claims ${tx({ company_id: actor.companyId, year: y, sick_cost: r.sickCost, total_cost: r.totalCost, amount: r.amount, voucher_id: v.id, created_by: actor.userId })}`;
    await auditBy(tx, actor, 'sick_pay_claim', 'company', actor.companyId, { year: y, amount: r.amount });
    return r.amount;
  });
}
