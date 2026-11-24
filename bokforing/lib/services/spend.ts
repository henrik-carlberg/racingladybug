import 'server-only';
import { sql } from '@/lib/db';
import { today } from '@/lib/format';
import { categoryOf, change, pareto, priceIncrease } from '@/lib/spend';

export async function overview(companyId: number) {
  const t = today();
  const inv = await sql<{ supplier_id: number; supplier: string; date: string; net: number; recent: boolean; prior: boolean }[]>`
    SELECT i.supplier_id, s.name AS supplier, to_char(i.invoice_date,'YYYY-MM-DD') AS date, (i.total - i.vat)::float8 AS net,
      i.invoice_date > ${t}::date - 365 AS recent, i.invoice_date <= ${t}::date - 365 AND i.invoice_date > ${t}::date - 730 AS prior
    FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id WHERE i.company_id = ${companyId} AND i.voucher_id IS NOT NULL AND i.invoice_date > ${t}::date - 730 ORDER BY i.invoice_date, i.id`;
  const lines = await sql<{ supplier_id: number; account: number; amount: number }[]>`SELECT i.supplier_id, l.account_number AS account, SUM(l.debit - l.credit)::float8 AS amount
    FROM supplier_invoices i JOIN voucher_lines l ON l.voucher_id = i.voucher_id WHERE i.company_id = ${companyId} AND i.invoice_date > ${t}::date - 365 AND l.account_number BETWEEN 4000 AND 7999 GROUP BY 1, 2`;
  const first = await sql<{ supplier_id: number; first: string }[]>`SELECT supplier_id, to_char(min(invoice_date),'YYYY-MM-DD') AS first FROM supplier_invoices WHERE company_id = ${companyId} GROUP BY 1`;
  const ids = [...new Set(inv.map((i) => i.supplier_id))];
  const suppliers = ids.map((id) => {
    const own = inv.filter((i) => i.supplier_id === id), recent = own.filter((i) => i.recent);
    const cats = lines.filter((l) => l.supplier_id === id).reduce<Record<string, number>>((m, l) => { const c = categoryOf(l.account); m[c] = (m[c] ?? 0) + l.amount; return m; }, {});
    const mainCategory = Object.entries(cats).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Övrigt';
    const spend = recent.reduce((s, i) => s + i.net, 0), prior = own.filter((i) => i.prior).reduce((s, i) => s + i.net, 0);
    const firstDate = first.find((f) => f.supplier_id === id)?.first ?? own[0].date;
    return { id, name: own[0].supplier, spend, prior, change: change(spend, prior), invoices: recent.length, category: mainCategory,
      isNew: firstDate > new Date(Date.parse(t) - 90 * 864e5).toISOString().slice(0, 10), priceIncrease: priceIncrease(recent.map((i) => i.net)), last: recent[recent.length - 1]?.net ?? 0 };
  }).filter((s) => s.spend > 0);
  const ranked = pareto(suppliers);
  const categories = Object.entries(lines.reduce<Record<string, number>>((m, l) => { const c = categoryOf(l.account); m[c] = (m[c] ?? 0) + l.amount; return m; }, {})).map(([name, spend]) => ({ name, spend })).sort((a, b) => b.spend - a.spend);
  // Samordning: små leverantörer (högst två fakturor och under 2 % av inköpen) i en kategori där det finns flera leverantörer
  const byCat = new Map<string, typeof ranked>();
  for (const s of ranked) byCat.set(s.category, [...(byCat.get(s.category) ?? []), s]);
  const consolidate = [...byCat].filter(([, ss]) => ss.length >= 3).flatMap(([cat, ss]) => ss.filter((s) => s.invoices <= 2 && s.share < 2).map((s) => ({ ...s, cat, peers: ss.length })));
  const total = ranked.reduce((s, r) => s + r.spend, 0), prior = ranked.reduce((s, r) => s + r.prior, 0);
  return { suppliers: ranked, categories, total, prior, change: change(total, prior), topCount: ranked.filter((r) => r.top).length, newSuppliers: ranked.filter((r) => r.isNew), increases: ranked.filter((r) => r.priceIncrease != null), consolidate };
}
