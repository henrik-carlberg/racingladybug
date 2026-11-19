import 'server-only';
import { sql } from '@/lib/db';
import { accountSums, fiscalYears, openingBalances } from '@/lib/server/ledger';
import { buildSie4 } from '@/lib/sie';

/** SIE 4-fil (text) för ett räkenskapsår, eller null om året inte finns */
export async function sieForYear(companyId: number, fyId: number): Promise<{ text: string; fy: { id: number; start_date: string; end_date: string } } | null> {
  const [co] = await sql<{ name: string; orgnr: string }[]>`SELECT name, orgnr FROM companies WHERE id = ${companyId}`;
  const years = await fiscalYears(companyId);
  const idx = years.findIndex((y) => y.id === fyId);
  if (idx < 0) return null;
  const fy = years[idx];
  const prev = years[idx + 1];
  const accounts = await sql<{ number: number; name: string }[]>`SELECT number, name FROM accounts WHERE company_id = ${companyId} ORDER BY number`;
  const ib = await openingBalances(companyId, fy.start_date);
  const sums = await accountSums(companyId, fy.start_date, fy.end_date);
  const ub = new Map(ib);
  const res = new Map<number, number>();
  for (const [n, v] of sums) {
    if (n < 3000) ub.set(n, (ub.get(n) ?? 0) + v);
    else res.set(n, v);
  }
  const vouchers = await sql<{ id: number; series: string; number: number; date: string; description: string; created: string }[]>`
    SELECT id, series, number, to_char(date,'YYYY-MM-DD') AS date, description, to_char(created_at,'YYYY-MM-DD') AS created
    FROM vouchers WHERE company_id = ${companyId} AND fiscal_year_id = ${fy.id} ORDER BY series, number`;
  const lines = await sql<{ voucher_id: number; account_number: number; debit: number; credit: number; description: string; cc: string | null; project_id: number | null }[]>`
    SELECT l.voucher_id, l.account_number, l.debit, l.credit, l.description, cc.code AS cc, l.project_id FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    LEFT JOIN cost_centers cc ON cc.id = l.cost_center_id
    WHERE v.company_id = ${companyId} AND v.fiscal_year_id = ${fy.id} ORDER BY l.id`;
  const costCenters = await sql<{ code: string; name: string }[]>`SELECT code, name FROM cost_centers WHERE company_id = ${companyId} ORDER BY code`;
  const projects = await sql<{ code: string; name: string }[]>`SELECT id::text AS code, name FROM projects WHERE company_id = ${companyId} ORDER BY id`;
  const byVoucher = new Map<number, (typeof lines)[number][]>();
  for (const l of lines) (byVoucher.get(l.voucher_id) ?? byVoucher.set(l.voucher_id, []).get(l.voucher_id)!).push(l);
  const text = buildSie4({
    companyName: co.name,
    orgnr: co.orgnr,
    fiscalYear: { start: fy.start_date, end: fy.end_date },
    previousYear: prev ? { start: prev.start_date, end: prev.end_date } : undefined,
    accounts: [...accounts],
    openingBalances: ib,
    closingBalances: ub,
    results: res,
    vouchers: vouchers.map((v) => ({
      ...v,
      lines: (byVoucher.get(v.id) ?? []).map((l) => ({ account: l.account_number, amount: l.debit - l.credit, description: l.description || undefined,
        costCenter: l.cc, project: l.project_id ? String(l.project_id) : null })),
    })),
    costCenters: [...costCenters], projects: [...projects],
  });
  return { text, fy };
}
