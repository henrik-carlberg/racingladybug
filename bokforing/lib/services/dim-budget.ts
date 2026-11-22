import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { followUp, type Kind } from '@/lib/dim-budget';
import type { Actor } from './actor';
import { str } from './input';

type Dim = 'cost_center' | 'project';
const dimOf = (v: unknown): Dim => (v === 'project' ? 'project' : 'cost_center');

async function dims(companyId: number, dim: Dim) {
  return dim === 'project'
    ? sql<{ id: number; name: string }[]>`SELECT id, name FROM projects WHERE company_id = ${companyId} ORDER BY name`
    : sql<{ id: number; name: string }[]>`SELECT id, code || ' ' || name AS name FROM cost_centers WHERE company_id = ${companyId} ORDER BY code`;
}

/** Budget mot utfall per dimension och månad för ett år: kostnader 4000–7999, intäkter 3000–3999 */
export async function overview(companyId: number, year: number, dim: Dim) {
  const list = await dims(companyId, dim);
  const budgets = await sql<{ dim_id: number; kind: Kind; month: number; amount: number }[]>`SELECT dim_id, kind, month, amount::float8 AS amount FROM dim_budgets
    WHERE company_id = ${companyId} AND year = ${year} AND dim = ${dim}`;
  const col = dim === 'project' ? sql`l.project_id` : sql`l.cost_center_id`;
  const actual = await sql<{ dim_id: number; month: number; cost: number; revenue: number }[]>`SELECT ${col} AS dim_id, extract(month from v.date)::int AS month,
    COALESCE(SUM(CASE WHEN l.account_number BETWEEN 4000 AND 7999 THEN l.debit - l.credit END), 0)::float8 AS cost,
    COALESCE(SUM(CASE WHEN l.account_number BETWEEN 3000 AND 3999 THEN l.credit - l.debit END), 0)::float8 AS revenue
    FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id WHERE v.company_id = ${companyId} AND extract(year from v.date) = ${year} AND ${col} IS NOT NULL GROUP BY 1, 2`;
  const t = today();
  const month = Number(t.slice(0, 4)) > year ? 12 : Number(t.slice(0, 4)) < year ? 0 : Number(t.slice(5, 7));
  const rows = list.flatMap((d) => (['cost', 'revenue'] as Kind[]).map((kind) => {
    const b = Array.from({ length: 12 }, (_, i) => budgets.find((x) => x.dim_id === d.id && x.kind === kind && x.month === i + 1)?.amount ?? 0);
    const a = Array.from({ length: 12 }, (_, i) => actual.find((x) => x.dim_id === d.id && x.month === i + 1)?.[kind] ?? 0);
    if (!b.some(Boolean) && !a.some(Boolean)) return null;
    return { dimId: d.id, name: d.name, kind, budget: b, actual: a, ...followUp({ kind, budget: b, actual: a, month }) };
  })).filter((r): r is NonNullable<typeof r> => !!r);
  return { year, dim, month, list, rows, warnings: rows.filter((r) => r.warn || r.overYear) };
}

/** Årsbudget fördelad lika på tolv månader, eller per månad */
export async function save(actor: Actor, input: Record<string, unknown>) {
  const dim = dimOf(input.dim), kind: Kind = input.kind === 'revenue' ? 'revenue' : 'cost';
  const year = Number(str(input, 'year'));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new ValidationError('Ange år');
  const dimId = Number(str(input, 'dim_id'));
  if (!(await dims(actor.companyId, dim)).some((d) => d.id === dimId)) throw new NotFoundError(dim === 'project' ? 'Projektet' : 'Kostnadsstället');
  const yearly = str(input, 'yearly') ? parseAmount(str(input, 'yearly')) : null;
  const months = Array.from({ length: 12 }, (_, i) => {
    if (yearly != null) return Math.floor(yearly / 12) + (i === 11 ? yearly - Math.floor(yearly / 12) * 12 : 0);
    const v = parseAmount(str(input, `m${i + 1}`) || '0');
    if (v == null) throw new ValidationError(`Ogiltigt belopp för månad ${i + 1}`);
    return v;
  });
  if (months.some((m) => m < 0)) throw new ValidationError('Budgeten kan inte vara negativ');
  await sql.begin(async (tx) => {
    await tx`DELETE FROM dim_budgets WHERE company_id = ${actor.companyId} AND year = ${year} AND dim = ${dim} AND dim_id = ${dimId} AND kind = ${kind}`;
    await tx`INSERT INTO dim_budgets ${tx(months.map((amount, i) => ({ company_id: actor.companyId, year, dim, dim_id: dimId, kind, month: i + 1, amount })))}`;
  });
  await auditBy(sql, actor, 'dim_budget', 'company', actor.companyId, { year, dim, dimId, kind });
}
