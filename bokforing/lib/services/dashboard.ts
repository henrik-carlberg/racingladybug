import 'server-only';
import { sql } from '@/lib/db';
import { accountSums, openingBalances } from '@/lib/server/ledger';
import { addMonths, lastDay, periodOf } from '@/lib/assets';
import { addDays, today } from '@/lib/format';
import { groupSums, sumRange } from '@/lib/monthly';
import { kpis, payBins } from '@/lib/kpi';

export async function dashboard(companyId: number) {
  const t = today();
  const cur = periodOf(t);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(cur, i - 11));
  const monthly = [];
  for (const p of months) {
    const g = groupSums(await accountSums(companyId, `${p}-01`, lastDay(p)));
    monthly.push({ label: p, revenue: g.revenue, cost: g.goods + g.external + g.staff + g.depreciation, result: g.result });
  }
  const cash = [];
  for (const p of months) cash.push({ label: p, value: sumRange(await openingBalances(companyId, addDays(p === cur ? t : lastDay(p), 1)), 1900, 1999) });
  // Prognos tre månader: kassan + kundfakturor som förfaller − leverantörsfakturor som förfaller (per månad)
  const forecast = [];
  let level = cash[cash.length - 1].value;
  for (let i = 1; i <= 3; i++) {
    const p = addMonths(cur, i);
    const from = i === 1 ? t : `${p}-01`;
    const [f] = await sql<{ inflow: number; outflow: number }[]>`SELECT
      COALESCE((SELECT SUM(total - paid_amount) FROM invoices WHERE company_id = ${companyId} AND status = 'booked' AND due_date ${i === 1 ? sql`<= ${lastDay(p)}` : sql`BETWEEN ${from} AND ${lastDay(p)}`}), 0)::bigint AS inflow,
      COALESCE((SELECT SUM(total - paid_amount) FROM supplier_invoices WHERE company_id = ${companyId} AND status IN ('booked','approved') AND due_date ${i === 1 ? sql`<= ${lastDay(p)}` : sql`BETWEEN ${from} AND ${lastDay(p)}`}), 0)::bigint AS outflow`;
    level += Number(f.inflow) - Number(f.outflow);
    forecast.push({ label: p, value: level });
  }
  const days = (await sql<{ d: number }[]>`SELECT (paid_date - invoice_date)::int AS d FROM invoices
    WHERE company_id = ${companyId} AND status = 'paid' AND credit_of_id IS NULL AND NOT imported AND paid_date IS NOT NULL AND total > 0 AND paid_date >= ${addMonths(cur, -12) + '-01'}`).map((r) => Number(r.d));
  const avg = days.length ? Math.round(days.reduce((s, d) => s + d, 0) / days.length) : null;
  const [fy] = await sql<{ start: string }[]>`SELECT to_char(start_date,'YYYY-MM-DD') AS start FROM fiscal_years WHERE company_id = ${companyId} AND start_date <= ${t} AND end_date >= ${t}`;
  const k = kpis({ balance: await openingBalances(companyId, addDays(t, 1)), result: await accountSums(companyId, fy?.start ?? `${t.slice(0, 4)}-01-01`, t), avgPayDays: avg });
  return { monthly, cash, forecast, bins: payBins(days), paidCount: days.length, kpis: k };
}
