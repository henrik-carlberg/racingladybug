import 'server-only';
import { sql } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import type { Actor } from './actor';

/** Tecken för att visa resultatkonton som positiva belopp: intäkter (3xxx, 8xxx-intäkter) kredit, kostnader debet */
export const signOf = (account: number) => (account < 4000 ? -1 : 1);

export async function budgetGrid(companyId: number, year: number) {
  const rows = await sql<{ account: number; month: number; amount: number }[]>`SELECT account, month, amount FROM account_budgets WHERE company_id = ${companyId} AND year = ${year}`;
  const actual = await sql<{ account: number; month: number; amount: number }[]>`
    SELECT l.account_number AS account, EXTRACT(MONTH FROM v.date)::int AS month, SUM(l.debit - l.credit)::bigint AS amount
    FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${companyId} AND l.account_number BETWEEN 3000 AND 8999 AND EXTRACT(YEAR FROM v.date)::int IN (${year}, ${year - 1})
      AND v.source_type IS DISTINCT FROM 'opening_balance' AND v.source_type IS DISTINCT FROM 'yearend'
      AND EXTRACT(YEAR FROM v.date)::int = ${year} GROUP BY 1, 2`;
  const prev = await sql<{ account: number }[]>`
    SELECT DISTINCT l.account_number AS account FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${companyId} AND l.account_number BETWEEN 3000 AND 8999 AND EXTRACT(YEAR FROM v.date)::int BETWEEN ${year - 1} AND ${year}`;
  const names = new Map((await sql<{ number: number; name: string }[]>`SELECT number, name FROM accounts WHERE company_id = ${companyId}`).map((a) => [a.number, a.name]));
  const accounts = [...new Set([...rows.map((r) => r.account), ...prev.map((r) => r.account)])].sort((a, b) => a - b);
  const budget = new Map<string, number>(rows.map((r) => [`${r.account}:${r.month}`, Number(r.amount)]));
  const act = new Map<string, number>(actual.map((r) => [`${r.account}:${r.month}`, signOf(r.account) * Number(r.amount)]));
  return { year, accounts: accounts.map((a) => ({ account: a, name: names.get(a) ?? '' })), budget, actual: act };
}

/** Sparar budgeten för ett år (ersätter allt för året) */
export async function saveBudget(actor: Actor, year: number, cells: { account: number; month: number; amount: number }[]) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new ValidationError('Ogiltigt år');
  for (const c of cells) if (c.account < 3000 || c.account > 8999 || c.month < 1 || c.month > 12) throw new ValidationError('Ogiltig budgetrad');
  await sql.begin(async (tx) => {
    await tx`DELETE FROM account_budgets WHERE company_id = ${actor.companyId} AND year = ${year}`;
    const rows = cells.filter((c) => c.amount).map((c) => ({ company_id: actor.companyId, year, ...c }));
    if (rows.length) await tx`INSERT INTO account_budgets ${tx(rows)}`;
    await auditBy(tx, actor, 'budget', 'company', actor.companyId, { year, cells: rows.length });
  });
}

/** Förslag: förra årets utfall per konto och månad */
export async function copyLastYear(actor: Actor, year: number, upliftPct = 0) {
  const rows = await sql<{ account: number; month: number; amount: number }[]>`
    SELECT l.account_number AS account, EXTRACT(MONTH FROM v.date)::int AS month, SUM(l.debit - l.credit)::bigint AS amount
    FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${actor.companyId} AND l.account_number BETWEEN 3000 AND 8999 AND EXTRACT(YEAR FROM v.date)::int = ${year - 1}
      AND v.source_type IS DISTINCT FROM 'yearend' GROUP BY 1, 2`;
  if (!rows.length) throw new ValidationError(`Det finns inget utfall för ${year - 1} att utgå från`);
  await saveBudget(actor, year, rows.map((r) => ({ account: r.account, month: r.month, amount: Math.round(signOf(r.account) * Number(r.amount) * (1 + upliftPct / 100)) })));
}
