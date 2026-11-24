import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { KINDS, replaceDue, returnStatus, warrantyEnding } from '@/lib/it-equipment';
import type { Actor } from './actor';
import { date, int, optInt, str } from './input';

type Row = { id: number; kind: keyof typeof KINDS; name: string; serial: string; purchased_on: string | null; cost: number; warranty_until: string | null; asset_id: number | null; asset: string | null; asset_active: boolean | null; employee_id: number | null; holder: string | null; assigned_on: string | null; status: string; note: string };

const select = (companyId: number) => sql<Row[]>`SELECT q.id, q.kind, q.name, q.serial, to_char(q.purchased_on,'YYYY-MM-DD') AS purchased_on, q.cost::float8 AS cost, to_char(q.warranty_until,'YYYY-MM-DD') AS warranty_until, q.asset_id, a.name AS asset, a.status = 'active' AS asset_active,
    q.employee_id, e.first_name || ' ' || e.last_name AS holder, to_char(q.assigned_on,'YYYY-MM-DD') AS assigned_on, q.status, q.note
  FROM it_equipment q LEFT JOIN employees e ON e.id = q.employee_id LEFT JOIN assets a ON a.id = q.asset_id WHERE q.company_id = ${companyId} ORDER BY q.status, holder NULLS LAST, q.name`;

export async function overview(companyId: number) {
  const t = today();
  const items = (await select(companyId)).map((i) => ({ ...i, replace: i.status === 'in_use' || i.status === 'in_stock' ? replaceDue(i.purchased_on, t) : false, warrantyIn: i.status === 'retired' || i.status === 'lost' ? null : warrantyEnding(i.warranty_until, t) }));
  const leaving = await sql<{ employee_id: number; name: string; last_day: string }[]>`SELECT t.employee_id, e.first_name || ' ' || e.last_name AS name, to_char(t.last_day,'YYYY-MM-DD') AS last_day FROM terminations t JOIN employees e ON e.id = t.employee_id
    WHERE t.company_id = ${companyId} AND (t.status = 'notice' OR EXISTS (SELECT 1 FROM it_equipment q WHERE q.employee_id = t.employee_id AND q.status = 'in_use')) ORDER BY t.last_day`;
  const employees = await sql<{ id: number; name: string }[]>`SELECT id, first_name || ' ' || last_name AS name FROM employees WHERE company_id = ${companyId} AND active ORDER BY 2`;
  const assets = await sql<{ id: number; name: string }[]>`SELECT id, name FROM assets WHERE company_id = ${companyId} AND status = 'active' ORDER BY name LIMIT 500`;
  const perHolder = new Map<string, { count: number; value: number }>();
  for (const i of items.filter((x) => x.status === 'in_use')) { const k = i.holder ?? '–'; const v = perHolder.get(k) ?? { count: 0, value: 0 }; v.count++; v.value += i.cost; perHolder.set(k, v); }
  return {
    items, employees, assets,
    returns: leaving.map((l) => { const own = items.filter((i) => i.employee_id === l.employee_id && i.status === 'in_use'); return { ...l, items: own, ...returnStatus(own, l.last_day, t) }; }),
    perHolder: [...perHolder].map(([name, v]) => ({ name, ...v })),
  };
}

/** Utrustning som ska lämnas tillbaka av en anställd (visas vid uppsägningen) */
export async function heldBy(companyId: number, employeeId: number) {
  return sql<{ id: number; kind: string; name: string; serial: string }[]>`SELECT id, kind, name, serial FROM it_equipment WHERE company_id = ${companyId} AND employee_id = ${employeeId} AND status = 'in_use' ORDER BY name`;
}

const ownEmployee = async (actor: Actor, id: number) => {
  const [e] = await sql`SELECT 1 FROM employees WHERE id = ${id} AND company_id = ${actor.companyId} AND active`;
  if (!e) throw new NotFoundError('Den anställda');
};

export async function add(actor: Actor, input: Record<string, unknown>) {
  const kind = String(input.kind);
  if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) throw new ValidationError('Välj typ av utrustning');
  const cost = String(input.cost ?? '').trim() ? parseAmount(String(input.cost)) : 0;
  if (cost == null || cost < 0) throw new ValidationError('Ogiltigt inköpspris');
  const assetId = optInt(input, 'asset_id'), employeeId = optInt(input, 'employee_id');
  if (assetId) { const [a] = await sql`SELECT 1 FROM assets WHERE id = ${assetId} AND company_id = ${actor.companyId}`; if (!a) throw new NotFoundError('Inventariet'); }
  if (employeeId) await ownEmployee(actor, employeeId);
  const t = today();
  return sql.begin(async (tx) => {
    const [r] = await tx<{ id: number }[]>`INSERT INTO it_equipment ${tx({ company_id: actor.companyId, kind, name: str(input, 'name', { required: true, label: 'Benämning', max: 100 }), serial: str(input, 'serial', { max: 100 }),
      purchased_on: date(input, 'purchased_on', 'Inköpt', false) || null, cost, warranty_until: date(input, 'warranty_until', 'Garanti till', false) || null, asset_id: assetId ?? null,
      employee_id: employeeId ?? null, assigned_on: employeeId ? t : null, status: employeeId ? 'in_use' : 'in_stock', note: str(input, 'note', { max: 300 }), created_by: actor.userId })} RETURNING id`;
    if (employeeId) await tx`INSERT INTO it_equipment_log ${tx({ equipment_id: r.id, action: 'assigned', employee_id: employeeId, at: t, created_by: actor.userId })}`;
    return r.id;
  });
}

const lockItem = async (tx: Tx, actor: Actor, id: number) => {
  const [q] = await tx<{ status: string; employee_id: number | null; name: string }[]>`SELECT status, employee_id, name FROM it_equipment WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
  if (!q) throw new NotFoundError('Utrustningen');
  return q;
};

export async function assign(actor: Actor, id: number, input: Record<string, unknown>) {
  const employeeId = int(input, 'employee_id', 'Anställd');
  await ownEmployee(actor, employeeId);
  return sql.begin(async (tx) => {
    const q = await lockItem(tx, actor, id);
    if (q.status !== 'in_stock') throw new ConflictError('Utrustningen är inte i lager');
    const t = today();
    await tx`UPDATE it_equipment SET employee_id = ${employeeId}, assigned_on = ${t}, status = 'in_use' WHERE id = ${id}`;
    await tx`INSERT INTO it_equipment_log ${tx({ equipment_id: id, action: 'assigned', employee_id: employeeId, at: t, created_by: actor.userId })}`;
  });
}

/** Återlämnad (till lager), förlorad eller kasserad */
export async function close(actor: Actor, id: number, action: 'returned' | 'lost' | 'retired', input: Record<string, unknown> = {}) {
  return sql.begin(async (tx) => {
    const q = await lockItem(tx, actor, id);
    if (action === 'returned' && q.status !== 'in_use') throw new ConflictError('Utrustningen är inte utlämnad');
    if (q.status === 'retired' || q.status === 'lost') throw new ConflictError('Utrustningen är redan avförd');
    const t = today();
    await tx`UPDATE it_equipment SET status = ${action === 'returned' ? 'in_stock' : action}, employee_id = ${action === 'returned' ? null : q.employee_id} WHERE id = ${id}`;
    await tx`INSERT INTO it_equipment_log ${tx({ equipment_id: id, action, employee_id: q.employee_id, at: t, note: str(input, 'note', { max: 300 }), created_by: actor.userId })}`;
    await auditBy(tx, actor, `it_equipment_${action}`, 'it_equipment', id, { name: q.name });
    return q.name;
  });
}
