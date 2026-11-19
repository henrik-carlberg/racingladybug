import 'server-only';
import { sql } from '@/lib/db';
import { compareBalances } from '@/lib/migration-check';
import type { SieFile } from '@/lib/sie';

/** Hur långt flytten har kommit: SIE-import, register och obetalda fakturor */
export async function migrationStatus(companyId: number) {
  const [s] = await sql<{ id: number; filename: string; program: string; year_start: string | null; year_end: string | null; vouchers: number }[]>`
    SELECT id, filename, data->>'program' AS program, data->'years'->'0'->>'start' AS year_start, data->'years'->'0'->>'end' AS year_end,
      COALESCE((result->>'vouchers')::int, 0) AS vouchers
    FROM sie_imports WHERE company_id = ${companyId} AND status = 'imported' ORDER BY id DESC LIMIT 1`;
  const [c] = await sql<{ customers: number; suppliers: number; open_ar: number; open_ap: number; imported_ar: number; imported_ap: number }[]>`
    SELECT (SELECT count(*)::int FROM customers WHERE company_id = ${companyId}) AS customers,
      (SELECT count(*)::int FROM suppliers WHERE company_id = ${companyId}) AS suppliers,
      (SELECT count(*)::int FROM invoices WHERE company_id = ${companyId} AND status = 'booked') AS open_ar,
      (SELECT count(*)::int FROM supplier_invoices WHERE company_id = ${companyId} AND status IN ('booked','approved')) AS open_ap,
      (SELECT count(*)::int FROM invoices WHERE company_id = ${companyId} AND imported) AS imported_ar,
      (SELECT count(*)::int FROM supplier_invoices WHERE company_id = ${companyId} AND voucher_id IS NULL AND status IN ('booked','approved')) AS imported_ap`;
  return { sie: s ?? null, ...c };
}

/** Jämför den senast importerade SIE-filen med bokföringen, och reskontrorna med 1510/2440 */
export async function migrationCheck(companyId: number) {
  const [imp] = await sql<{ id: number; data: SieFile }[]>`SELECT id, data FROM sie_imports WHERE company_id = ${companyId} AND status = 'imported' ORDER BY id DESC LIMIT 1`;
  const names = Object.fromEntries((await sql<{ number: number; name: string }[]>`SELECT number, name FROM accounts WHERE company_id = ${companyId}`).map((a) => [a.number, a.name]));
  let sie: null | { year: { start: string; end: string }; hasVouchers: boolean; closing: ReturnType<typeof compareBalances> | null; result: ReturnType<typeof compareBalances> | null; opening: ReturnType<typeof compareBalances> } = null;
  if (imp?.data.years?.[0]) {
    const f = imp.data; const y = f.years[0];
    const bal = async (filter: 'opening' | 'closing' | 'result') => {
      const rows = await sql<{ account: number; v: number }[]>`
        SELECT l.account_number AS account, SUM(l.debit - l.credit)::bigint AS v FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id JOIN fiscal_years fy ON fy.id = v.fiscal_year_id
        WHERE v.company_id = ${companyId} AND fy.start_date = ${y.start}
          ${filter === 'opening' ? sql`AND v.source_type = 'opening_balance' AND l.account_number < 3000` : filter === 'closing' ? sql`AND l.account_number < 3000` : sql`AND l.account_number >= 3000`}
        GROUP BY l.account_number`;
      return Object.fromEntries(rows.map((r) => [r.account, Number(r.v)]));
    };
    const onlyBalance = (m: Record<number, number> = {}) => Object.fromEntries(Object.entries(m).filter(([a]) => Number(a) < 3000));
    sie = {
      year: y, hasVouchers: f.vouchers.length > 0,
      opening: compareBalances(onlyBalance(f.openingBalances[0]), await bal('opening'), names),
      // Utgående saldon och resultat går bara att jämföra om verifikationerna följde med
      closing: f.vouchers.length && f.closingBalances[0] ? compareBalances(onlyBalance(f.closingBalances[0]), await bal('closing'), names) : null,
      result: f.vouchers.length && f.results[0] ? compareBalances(f.results[0], await bal('result'), names) : null,
    };
  }
  const [r] = await sql<{ ar: number; ar_ledger: number; ap: number; ap_ledger: number; ar_n: number; ap_n: number }[]>`
    SELECT (SELECT COALESCE(SUM(total - paid_amount), 0)::bigint FROM invoices WHERE company_id = ${companyId} AND status = 'booked' AND currency = 'SEK') AS ar,
      (SELECT count(*)::int FROM invoices WHERE company_id = ${companyId} AND status = 'booked') AS ar_n,
      (SELECT COALESCE(SUM(l.debit - l.credit), 0)::bigint FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id WHERE v.company_id = ${companyId} AND l.account_number BETWEEN 1510 AND 1519) AS ar_ledger,
      (SELECT COALESCE(SUM(total - paid_amount), 0)::bigint FROM supplier_invoices WHERE company_id = ${companyId} AND status IN ('booked','approved')) AS ap,
      (SELECT count(*)::int FROM supplier_invoices WHERE company_id = ${companyId} AND status IN ('booked','approved')) AS ap_n,
      (SELECT COALESCE(SUM(l.credit - l.debit), 0)::bigint FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id WHERE v.company_id = ${companyId} AND l.account_number BETWEEN 2440 AND 2449) AS ap_ledger`;
  const ledgers = {
    ar: { open: Number(r.ar), ledger: Number(r.ar_ledger), count: r.ar_n },
    ap: { open: Number(r.ap), ledger: Number(r.ap_ledger), count: r.ap_n },
  };
  return { sie, ledgers };
}
