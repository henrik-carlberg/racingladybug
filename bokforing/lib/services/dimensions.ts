import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import type { Actor } from './actor';

export interface CostCenter { id: number; code: string; name: string; active: boolean }
export interface ProjectRef { id: number; name: string; customer: string; active: boolean }

export async function listCostCenters(companyId: number, activeOnly = false): Promise<CostCenter[]> {
  return [...await sql<CostCenter[]>`SELECT id, code, name, active FROM cost_centers WHERE company_id = ${companyId} ${activeOnly ? sql`AND active` : sql``} ORDER BY code`];
}

export async function listProjectRefs(companyId: number, activeOnly = false): Promise<ProjectRef[]> {
  return [...await sql<ProjectRef[]>`SELECT p.id, p.name, c.name AS customer, p.active FROM projects p JOIN customers c ON c.id = p.customer_id
    WHERE p.company_id = ${companyId} ${activeOnly ? sql`AND p.active` : sql``} ORDER BY p.name`];
}

export async function createCostCenter(actor: Actor, code: string, name: string) {
  const c = code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,20}$/.test(c)) throw new ValidationError('Koden får bara innehålla bokstäver, siffror, - och _ (högst 20 tecken)');
  if (!name.trim()) throw new ValidationError('Ange ett namn');
  try {
    const [r] = await sql<{ id: number }[]>`INSERT INTO cost_centers (company_id, code, name) VALUES (${actor.companyId}, ${c}, ${name.trim()}) RETURNING id`;
    await auditBy(sql, actor, 'create', 'cost_center', r.id, { code: c });
    return r.id;
  } catch (e) {
    if (String((e as Error).message).includes('cost_centers_company_id_code_key')) throw new ConflictError(`Kostnadsstället ${c} finns redan`);
    throw e;
  }
}

export async function updateCostCenter(actor: Actor, id: number, input: { name: string; active: boolean }) {
  const r = await sql`UPDATE cost_centers SET name = ${input.name.trim()}, active = ${input.active} WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!r.count) throw new NotFoundError('Kostnadsstället');
  await auditBy(sql, actor, 'update', 'cost_center', id, input);
}

/** Tolkar ett valt kostnadsställe/projekt från ett formulär ("" = inget) */
export const dimId = (v: unknown): number | null => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

/** Resultat per konto och objekt (kostnadsställe eller projekt) för en period. Belopp: intäkt positiv, kostnad negativ. */
export async function resultByDimension(companyId: number, dim: 'cost_center' | 'project', from: string, to: string) {
  const col = dim === 'cost_center' ? sql`l.cost_center_id` : sql`l.project_id`;
  const rows = await sql<{ account: number; name: string; object: number | null; amount: number }[]>`
    SELECT l.account_number AS account, a.name, ${col} AS object, SUM(l.credit - l.debit)::bigint AS amount
    FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id LEFT JOIN accounts a ON a.company_id = v.company_id AND a.number = l.account_number
    WHERE v.company_id = ${companyId} AND v.date BETWEEN ${from} AND ${to} AND l.account_number BETWEEN 3000 AND 8999
    GROUP BY l.account_number, a.name, ${col} ORDER BY l.account_number`;
  const objects = dim === 'cost_center'
    ? (await listCostCenters(companyId)).map((c) => ({ id: c.id, label: `${c.code} ${c.name}` }))
    : (await listProjectRefs(companyId)).map((p) => ({ id: p.id, label: `${p.name} (${p.customer})` }));
  const used = new Set(rows.map((r) => r.object));
  const cols = [...objects.filter((o) => used.has(o.id)), ...(used.has(null) ? [{ id: null as number | null, label: 'Utan' }] : [])];
  const accounts = [...new Map(rows.map((r) => [r.account, r.name ?? ''])).entries()].map(([account, name]) => ({
    account, name, values: Object.fromEntries(cols.map((c) => [String(c.id), Number(rows.find((r) => r.account === account && r.object === c.id)?.amount ?? 0)])),
  }));
  const total = (id: number | null) => accounts.reduce((s, a) => s + a.values[String(id)], 0);
  return { columns: cols, accounts, totals: Object.fromEntries(cols.map((c) => [String(c.id), total(c.id)])) };
}
