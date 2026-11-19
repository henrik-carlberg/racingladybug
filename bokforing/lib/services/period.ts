import 'server-only';
import { sql } from '@/lib/db';
import type { Period, SupplierHistory } from '@/lib/checks';

/** Låst period och räkenskapsår – för kontrollerna i formulären */
export async function companyPeriod(companyId: number): Promise<Period> {
  const [c] = await sql<{ locked: string | null }[]>`SELECT to_char(locked_until,'YYYY-MM-DD') AS locked FROM companies WHERE id = ${companyId}`;
  const fys = await sql<{ start: string; end: string; closed: boolean }[]>`
    SELECT to_char(start_date,'YYYY-MM-DD') AS start, to_char(end_date,'YYYY-MM-DD') AS "end", closed FROM fiscal_years WHERE company_id = ${companyId} ORDER BY start_date`;
  return { lockedUntil: c?.locked ?? null, fiscalYears: [...fys] };
}

/** Per leverantör: antal fakturor, medianbelopp, senaste fakturanumren och belopp de senaste månaderna */
export async function supplierHistories(companyId: number): Promise<Record<string, SupplierHistory>> {
  const rows = await sql<{ supplier_id: number; count: number; median: number; numbers: string[]; recent: { date: string; total: number }[] | null }[]>`
    SELECT supplier_id, count(*)::int AS count,
      (percentile_cont(0.5) WITHIN GROUP (ORDER BY total))::bigint AS median,
      (array_agg(invoice_number ORDER BY id DESC))[1:50] AS numbers,
      json_agg(json_build_object('date', to_char(invoice_date,'YYYY-MM-DD'), 'total', total)) FILTER (WHERE invoice_date >= current_date - 120) AS recent
    FROM supplier_invoices WHERE company_id = ${companyId} AND invoice_date >= current_date - 730 GROUP BY supplier_id`;
  return Object.fromEntries(rows.map((r) => [String(r.supplier_id), { count: r.count, median: Number(r.median), numbers: r.numbers, recent: (r.recent ?? []).map((x) => ({ date: x.date, total: Number(x.total) })) }]));
}
