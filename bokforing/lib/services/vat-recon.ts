import 'server-only';
import { sql } from '@/lib/db';
import { accountSums } from '@/lib/server/ledger';
import { vatReport } from '@/lib/vat';
import { periodicSummary } from '@/lib/eu';
import { euLines } from '@/lib/services/eu';
import { vatChecks } from '@/lib/services/tax-planning';
import { checkVoucher, euCompare } from '@/lib/vat-recon';

export async function reconcile(companyId: number, from: string, to: string) {
  const rows = await sql<{ id: number; label: string; date: string; description: string; source_type: string | null; account: number; amount: number }[]>`
    SELECT v.id, v.series || v.number AS label, to_char(v.date,'YYYY-MM-DD') AS date, v.description, v.source_type, l.account_number AS account, (l.credit - l.debit)::float8 AS amount
    FROM vouchers v JOIN voucher_lines l ON l.voucher_id = v.id
    WHERE v.company_id = ${companyId} AND v.date BETWEEN ${from} AND ${to} AND COALESCE(v.source_type, '') NOT IN ('vat', 'vat_correction')
      AND EXISTS (SELECT 1 FROM voucher_lines x WHERE x.voucher_id = v.id AND (x.account_number BETWEEN 2610 AND 2649 OR x.account_number BETWEEN 3000 AND 3399 OR x.account_number BETWEEN 4415 AND 4535))
    ORDER BY v.date, v.id`;
  const byVoucher = new Map<number, { id: number; label: string; date: string; description: string; source: string | null; lines: { account: number; amount: number }[] }>();
  for (const r of rows) {
    const v = byVoucher.get(r.id) ?? { id: r.id, label: r.label, date: r.date, description: r.description, source: r.source_type, lines: [] };
    v.lines.push({ account: r.account, amount: r.amount });
    byVoucher.set(r.id, v);
  }
  const deviations = [...byVoucher.values()].map((v) => ({ ...v, issues: checkVoucher(v.lines) })).filter((v) => v.issues.length);
  const sums = await accountSums(companyId, from, to, { excludeVatSettlements: true });
  const { boxes } = vatReport(sums);
  const g = (n: number[]) => -n.reduce((a, k) => a + (sums.get(k) ?? 0), 0);
  const ps = periodicSummary(await euLines(companyId, from, to));
  const eu = euCompare({ goods: g([3106, 3108]), services: g([3308]) }, { goods: ps.totalGoods, services: ps.totalServices });
  const euManual = [...byVoucher.values()].filter((v) => v.source !== 'invoice' && v.lines.some((l) => [3106, 3108, 3308].includes(l.account)));
  return { boxes, checks: (await vatChecks(companyId, from, to)).checks, deviations, vouchers: byVoucher.size, eu, euMissing: ps.missing, euManual };
}
