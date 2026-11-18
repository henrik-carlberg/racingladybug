import 'server-only';
import { sql } from '@/lib/db';
import { accountSums, openingBalances } from '@/lib/server/ledger';
import { addMonths, lastDay } from '@/lib/assets';
import { addDays } from '@/lib/format';
import { groupSums, highlights, sumRange } from '@/lib/monthly';

export async function monthlyReport(companyId: number, period: string) {
  const from = `${period}-01`, to = lastDay(period);
  const prevYear = addMonths(period, -12);
  const [fy] = await sql<{ start: string }[]>`SELECT to_char(start_date,'YYYY-MM-DD') AS start FROM fiscal_years WHERE company_id = ${companyId} AND start_date <= ${to} AND end_date >= ${to}`;
  const ytdFrom = fy?.start ?? `${period.slice(0, 4)}-01-01`;
  const [now, prev, ytd, endBal, startBal, names] = await Promise.all([
    accountSums(companyId, from, to), accountSums(companyId, `${prevYear}-01`, lastDay(prevYear)), accountSums(companyId, ytdFrom, to),
    openingBalances(companyId, addDays(to, 1)), openingBalances(companyId, from),
    sql<{ number: number; name: string }[]>`SELECT number, name FROM accounts WHERE company_id = ${companyId}`,
  ]);
  const g = groupSums(now), gp = groupSums(prev), gy = groupSums(ytd);
  const cash = sumRange(endBal, 1900, 1999), cashPrev = sumRange(startBal, 1900, 1999);
  const vatDue = -(sumRange(endBal, 2610, 2650));
  const [ar] = await sql<{ open: number; overdue: number; n: number }[]>`
    SELECT COALESCE(SUM(total - paid_amount), 0)::bigint AS open, COALESCE(SUM(total - paid_amount) FILTER (WHERE due_date < ${to}), 0)::bigint AS overdue,
      count(*) FILTER (WHERE due_date < ${to})::int AS n
    FROM invoices WHERE company_id = ${companyId} AND status = 'booked' AND invoice_date <= ${to}`;
  const [ap] = await sql<{ open: number }[]>`SELECT COALESCE(SUM(total - paid_amount), 0)::bigint AS open FROM supplier_invoices WHERE company_id = ${companyId} AND status IN ('booked','approved') AND invoice_date <= ${to}`;
  const nameOf = new Map(names.map((a) => [a.number, a.name]));
  const topCosts = [...now].filter(([a, v]) => a >= 4000 && a <= 7999 && Number(v) > 0).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 5)
    .map(([a, v]) => ({ account: a, name: nameOf.get(a) ?? '', amount: Number(v) }));
  const [{ vouchers }] = await sql<{ vouchers: number }[]>`SELECT count(*)::int AS vouchers FROM vouchers WHERE company_id = ${companyId} AND date BETWEEN ${from} AND ${to}`;
  return {
    period, from, to, month: g, prevYear: gp, ytd: gy, ytdFrom, cash, cashPrev, vatDue, vouchers,
    receivables: Number(ar.open), overdue: Number(ar.overdue), overdueCount: ar.n, payables: Number(ap.open), topCosts,
    highlights: highlights({ revenue: g.revenue, revenuePrev: gp.revenue, result: g.result, cash, cashPrev, overdue: Number(ar.overdue), overdueCount: ar.n, vatDue }),
  };
}
export type MonthlyReport = Awaited<ReturnType<typeof monthlyReport>>;

/** Rapporten som e-post i klartext */
export function monthlyReportText(r: MonthlyReport, company: string, link: string) {
  const kr = (v: number) => `${Math.round(v / 100).toLocaleString('sv-SE')} kr`;
  return [
    `Månadsrapport ${r.period} – ${company}`, '',
    ...r.highlights.map((h) => `• ${h}`), '',
    `Intäkter: ${kr(r.month.revenue)} (i fjol ${kr(r.prevYear.revenue)})`,
    `Resultat: ${kr(r.month.result)} (hittills i år ${kr(r.ytd.result)})`,
    `Kassa och bank: ${kr(r.cash)}`,
    `Kundfordringar: ${kr(r.receivables)}, varav förfallet ${kr(r.overdue)}`,
    `Leverantörsskulder: ${kr(r.payables)}`, '',
    `Hela rapporten: ${link}`,
  ].join('\n');
}
