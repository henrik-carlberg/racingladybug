import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { accountSums, fiscalYearFor } from '@/lib/server/ledger';
import { today } from '@/lib/format';
import { methodChangeError } from '@/lib/accounting-method';

/** Nettoomsättning (3000–3799) för ett datumintervall */
export async function turnover(companyId: number, from: string, to: string) {
  let t = 0;
  for (const [n, v] of await accountSums(companyId, from, to)) if (n >= 3000 && n <= 3799) t -= Number(v);
  return t;
}

/** Kontrollerar ett byte av redovisningsmetod och sparar det i historiken. Kastar med förklaring om bytet inte är tillåtet. */
export async function changeMethod(tx: Tx, companyId: number, userId: number, to: 'invoice' | 'cash') {
  const [c] = await tx<{ m: 'invoice' | 'cash' }[]>`SELECT accounting_method AS m FROM companies WHERE id = ${companyId} FOR UPDATE`;
  if (c.m === to) return;
  const fy = await fiscalYearFor(tx, companyId, today());
  const [prev] = fy ? await tx<{ start: string; end: string }[]>`SELECT to_char(start_date,'YYYY-MM-DD') AS start, to_char(end_date,'YYYY-MM-DD') AS "end" FROM fiscal_years
    WHERE company_id = ${companyId} AND end_date < ${fy.start_date} ORDER BY end_date DESC LIMIT 1` : [];
  const [o] = await tx<{ booked: number; open: number }[]>`SELECT
    ${fy ? tx`(SELECT count(*) FROM invoices WHERE company_id = ${companyId} AND voucher_id IS NOT NULL AND invoice_date >= ${fy.start_date})::int +
      (SELECT count(*) FROM supplier_invoices WHERE company_id = ${companyId} AND voucher_id IS NOT NULL AND invoice_date >= ${fy.start_date})::int` : tx`0`} AS booked,
    (SELECT count(*) FROM invoices WHERE company_id = ${companyId} AND status = 'booked' AND voucher_id IS NULL)::int +
      (SELECT count(*) FROM supplier_invoices WHERE company_id = ${companyId} AND status IN ('booked','approved') AND voucher_id IS NULL)::int AS open`;
  const err = methodChangeError({ from: c.m, to, turnover: prev ? await turnover(companyId, prev.start, prev.end) : null, bookedThisYear: o.booked, unbookedOpen: o.open });
  if (err) throw new Error(err);
  await tx`INSERT INTO accounting_method_changes (company_id, from_method, to_method, changed_by) VALUES (${companyId}, ${c.m}, ${to}, ${userId})`;
}
export const methodHistory = (companyId: number, db: Tx | typeof sql = sql) => db<{ from_method: string; to_method: string; changed_at: string }[]>`SELECT from_method, to_method,
  to_char(changed_at,'YYYY-MM-DD') AS changed_at FROM accounting_method_changes WHERE company_id = ${companyId} ORDER BY changed_at DESC LIMIT 10`;
