import 'server-only';
import { sql } from '@/lib/db';
import { accountSums, fiscalYears, openingBalances } from '@/lib/server/ledger';
import { budgetAsLedger, incomeStatement, minusYear } from '@/lib/statements';
import { today } from '@/lib/format';

export type Compare = 'none' | 'fjol' | 'budget';

async function budgetSums(companyId: number, from: string, to: string) {
  const rows = await sql<{ account: number; v: number }[]>`
    SELECT account, SUM(amount)::bigint AS v FROM account_budgets WHERE company_id = ${companyId}
      AND make_date(year, month, 1) BETWEEN date_trunc('month', ${from}::date) AND date_trunc('month', ${to}::date) GROUP BY account`;
  return budgetAsLedger(new Map(rows.map((r) => [r.account, Number(r.v)])));
}

/** Resultat- och balansräkning för perioden, med jämförelse mot samma period förra året eller mot budget */
export async function statements(companyId: number, opts: { fy?: string; from?: string; to?: string; compare?: Compare }) {
  const years = await fiscalYears(companyId);
  const t = today();
  const fy = years.find((y) => String(y.id) === opts.fy) ?? years.find((y) => y.start_date <= t && t <= y.end_date) ?? years[0];
  if (!fy) return null;
  const to = opts.to || (fy.end_date < t ? fy.end_date : t);
  const from = opts.from || fy.start_date;
  const compare = opts.compare ?? 'none';
  const names = new Map((await sql<{ number: number; name: string }[]>`SELECT number, name FROM accounts WHERE company_id = ${companyId}`).map((a) => [a.number, a.name]));
  const sums = await accountSums(companyId, from, to);
  const cmp = compare === 'fjol' ? await accountSums(companyId, minusYear(from), minusYear(to)) : compare === 'budget' ? await budgetSums(companyId, from, to) : null;
  const income = incomeStatement(sums, cmp, names);
  const ib = await openingBalances(companyId, fy.start_date);
  const ub = new Map(ib);
  for (const [n, v] of await accountSums(companyId, fy.start_date, to)) if (n < 3000) ub.set(n, (ub.get(n) ?? 0) + v);
  // Balans samma dag förra året (för jämförelse mot fjolår)
  let ubPrev: Map<number, number> | null = null;
  if (compare === 'fjol') {
    const pfy = years.find((y) => y.start_date <= minusYear(to) && minusYear(to) <= y.end_date);
    if (pfy) {
      ubPrev = new Map(await openingBalances(companyId, pfy.start_date));
      for (const [n, v] of await accountSums(companyId, pfy.start_date, minusYear(to))) if (n < 3000) ubPrev.set(n, (ubPrev.get(n) ?? 0) + v);
    }
  }
  return { fy, years, from, to, compare, names, income, ib, ub, ubPrev };
}
