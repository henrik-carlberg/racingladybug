import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { calculate, completeLines, startLines, variance, WIP, WIP_CHANGE, type Bom } from '@/lib/manufacturing';
import type { Actor } from '@/lib/services/actor';
import { date, int } from '@/lib/services/input';
import { parseQty } from './calc';
import { move, warehouseId } from './service';

const NAMES: Record<number, string> = { [WIP]: 'Produkter i arbete', [WIP_CHANGE]: 'Förändring av produkter i arbete', 1460: 'Lager av handelsvaror' };
async function ensure(tx: Tx, companyId: number) { for (const [n, name] of Object.entries(NAMES)) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${companyId}, ${Number(n)}, ${name}) ON CONFLICT DO NOTHING`; }
const num = (v: unknown, label: string, max = 1e9) => { const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.') || '0'); if (!(n >= 0 && n <= max)) throw new ValidationError(`Ogiltigt värde: ${label}`); return n; };

async function loadBom(db: Tx | typeof sql, companyId: number, bomId: number): Promise<Bom & { id: number; product_id: number }> {
  const [b] = await db<{ id: number; product_id: number; labor_minutes: number; labor_rate: number; overhead_pct: number }[]>`SELECT id, product_id, labor_minutes::float8 AS labor_minutes, labor_rate::float8 AS labor_rate, overhead_pct::float8 AS overhead_pct
    FROM inv_boms WHERE id = ${bomId} AND company_id = ${companyId}`;
  if (!b) throw new NotFoundError('Stycklistan');
  const lines = await db<{ component_id: number; qty: number; avg_cost: number }[]>`SELECT l.component_id, l.qty::float8 AS qty, p.avg_cost::float8 AS avg_cost FROM inv_bom_lines l JOIN inv_products p ON p.id = l.component_id WHERE l.bom_id = ${bomId}`;
  return { id: b.id, product_id: b.product_id, laborMinutes: b.labor_minutes, laborRate: b.labor_rate, overheadPct: b.overhead_pct, lines: lines.map((l) => ({ componentId: l.component_id, qty: l.qty, avgCost: l.avg_cost })) };
}

/** Stycklista: komponenter per tillverkad enhet, arbetstid per enhet, timkostnad och omkostnadspålägg */
export async function saveBom(actor: Actor, input: Record<string, unknown>) {
  const productId = int(input, 'product_id', 'Produkt');
  const lines: { component: number; qty: number }[] = [];
  for (let i = 0; i < 8; i++) {
    const c = String(input[`component_${i}`] ?? '').trim();
    if (!c) continue;
    const q = parseQty(input[`cqty_${i}`]);
    if (!q || q <= 0) throw new ValidationError(`Rad ${i + 1}: ange antal`);
    lines.push({ component: Number(c), qty: q });
  }
  if (!lines.length) throw new ValidationError('Lägg till minst en komponent');
  if (lines.some((l) => l.component === productId)) throw new ValidationError('Produkten kan inte vara en komponent i sig själv');
  if (new Set(lines.map((l) => l.component)).size !== lines.length) throw new ValidationError('Samma komponent finns på flera rader');
  const ids = [productId, ...lines.map((l) => l.component)];
  const found = await sql<{ id: number }[]>`SELECT id FROM inv_products WHERE company_id = ${actor.companyId} AND id IN ${sql(ids)}`;
  if (found.length !== new Set(ids).size) throw new ValidationError('Artikeln finns inte');
  const rate = parseAmount(String(input.labor_rate ?? '0') || '0') ?? 0;
  return sql.begin(async (tx) => {
    const [b] = await tx<{ id: number }[]>`INSERT INTO inv_boms ${tx({ company_id: actor.companyId, product_id: productId, labor_minutes: num(input.labor_minutes, 'arbetstid', 1e6), labor_rate: rate, overhead_pct: num(input.overhead_pct, 'omkostnadspålägg', 500) })}
      ON CONFLICT (company_id, product_id) DO UPDATE SET labor_minutes = EXCLUDED.labor_minutes, labor_rate = EXCLUDED.labor_rate, overhead_pct = EXCLUDED.overhead_pct RETURNING id`;
    await tx`DELETE FROM inv_bom_lines WHERE bom_id = ${b.id}`;
    for (const l of lines) await tx`INSERT INTO inv_bom_lines (bom_id, component_id, qty) VALUES (${b.id}, ${l.component}, ${l.qty})`;
    await auditBy(tx, actor, 'save', 'inv.bom', b.id);
    return b.id;
  });
}

export async function createOrder(actor: Actor, input: Record<string, unknown>) {
  const qty = parseQty(input.qty);
  if (!qty || qty <= 0) throw new ValidationError('Ange antal att tillverka');
  return sql.begin(async (tx) => {
    const b = await loadBom(tx, actor.companyId, int(input, 'bom_id', 'Stycklista'));
    const wid = await warehouseId(tx, actor.companyId, input);
    await tx`SELECT pg_advisory_xact_lock(111001, ${actor.companyId})`;
    const [{ n }] = await tx<{ n: number }[]>`SELECT COALESCE(max(number), 0)::int + 1 AS n FROM inv_production_orders WHERE company_id = ${actor.companyId}`;
    const c = calculate(b, qty);
    const [o] = await tx<{ id: number }[]>`INSERT INTO inv_production_orders ${tx({ company_id: actor.companyId, number: n, bom_id: b.id, product_id: b.product_id, warehouse_id: wid, qty,
      planned: tx.json({ material: c.material, labor: c.labor, overhead: c.overhead } as never) as never, created_by: actor.userId })} RETURNING id`;
    await auditBy(tx, actor, 'create', 'inv.production_order', o.id, { qty });
    return o.id;
  });
}

type Order = { id: number; number: number; bom_id: number; product_id: number; warehouse_id: number; qty: number; status: string; material: number; sku: string };
async function order(tx: Tx, companyId: number, id: number) {
  const [o] = await tx<Order[]>`SELECT o.id, o.number, o.bom_id, o.product_id, o.warehouse_id, o.qty::float8 AS qty, o.status, o.material::float8 AS material, p.sku
    FROM inv_production_orders o JOIN inv_products p ON p.id = o.product_id WHERE o.id = ${id} AND o.company_id = ${companyId} FOR UPDATE OF o`;
  if (!o) throw new NotFoundError('Tillverkningsordern');
  return o;
}

/** Start: komponenterna dras från lagret till snittpris och förs till produkter i arbete (1440) */
export async function start(actor: Actor, id: number, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum', false) || today();
  return sql.begin(async (tx) => {
    const o = await order(tx, actor.companyId, id);
    if (o.status !== 'planned') throw new ConflictError('Ordern är redan startad');
    const b = await loadBom(tx, actor.companyId, o.bom_id);
    let material = 0;
    for (const l of b.lines) {
      const q = Math.round(l.qty * o.qty * 1000) / 1000;
      const [p] = await tx<{ avg: number }[]>`SELECT avg_cost::float8 AS avg FROM inv_products WHERE id = ${l.componentId}`;
      await move(tx, actor, { product_id: l.componentId, warehouse_id: o.warehouse_id, qty: -q, type: 'delivery', date: d, ref_type: 'production', ref_id: o.id, note: `Tillverkningsorder ${o.number}` });
      material += Math.round(q * p.avg);
    }
    await ensure(tx, actor.companyId);
    const lines = startLines(material);
    const v = lines.length ? await createVoucher(tx, { actor, date: d, description: `Tillverkningsorder ${o.number}: material till produkter i arbete (${o.qty} ${o.sku})`, lines: fromSigned(lines), sourceType: 'production', sourceId: o.id }) : null;
    await tx`UPDATE inv_production_orders SET status = 'started', started_on = ${d}, material = ${material}, start_voucher_id = ${v?.id ?? null} WHERE id = ${o.id}`;
    await auditBy(tx, actor, 'start', 'inv.production_order', o.id, { material });
    return material;
  });
}

/** Färdigställande: faktisk arbetstid, omkostnader och material blir produktens anskaffningsvärde i lagret */
export async function complete(actor: Actor, id: number, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum', false) || today();
  return sql.begin(async (tx) => {
    const o = await order(tx, actor.companyId, id);
    if (o.status !== 'started') throw new ConflictError('Ordern måste vara startad');
    const b = await loadBom(tx, actor.companyId, o.bom_id);
    const minutes = String(input.minutes ?? '').trim() ? num(input.minutes, 'arbetstid', 1e7) : b.laborMinutes * o.qty;
    const labor = Math.round((minutes * b.laborRate) / 60);
    const overhead = Math.round(((o.material + labor) * b.overheadPct) / 100);
    const total = o.material + labor + overhead;
    await move(tx, actor, { product_id: o.product_id, warehouse_id: o.warehouse_id, qty: o.qty, unit_cost: total / o.qty, type: 'receipt', date: d, ref_type: 'production', ref_id: o.id, note: `Tillverkningsorder ${o.number}` });
    await ensure(tx, actor.companyId);
    const v = total ? await createVoucher(tx, { actor, date: d, description: `Tillverkningsorder ${o.number} färdig: ${o.qty} ${o.sku} till självkostnad`, lines: fromSigned(completeLines(o.material, labor, overhead)), sourceType: 'production', sourceId: o.id }) : null;
    await tx`UPDATE inv_production_orders SET status = 'done', done_on = ${d}, labor = ${labor}, overhead = ${overhead}, actual_minutes = ${minutes}, done_voucher_id = ${v?.id ?? null} WHERE id = ${o.id}`;
    await auditBy(tx, actor, 'complete', 'inv.production_order', o.id, { total });
    return { total, perUnit: total / o.qty };
  });
}

export async function cancel(actor: Actor, id: number) {
  return sql.begin(async (tx) => {
    const o = await order(tx, actor.companyId, id);
    if (o.status !== 'planned') throw new ConflictError('Bara planerade order kan makuleras');
    await tx`UPDATE inv_production_orders SET status = 'cancelled' WHERE id = ${o.id}`;
    await auditBy(tx, actor, 'cancel', 'inv.production_order', o.id);
  });
}

export async function overview(companyId: number) {
  const boms = await sql<{ id: number; product_id: number; sku: string; name: string; labor_minutes: number; labor_rate: number; overhead_pct: number }[]>`
    SELECT b.id, b.product_id, p.sku, p.name, b.labor_minutes::float8 AS labor_minutes, b.labor_rate::float8 AS labor_rate, b.overhead_pct::float8 AS overhead_pct FROM inv_boms b JOIN inv_products p ON p.id = b.product_id WHERE b.company_id = ${companyId} ORDER BY p.sku`;
  const withCalc = [];
  for (const b of boms) { const full = await loadBom(sql, companyId, b.id); const comps = await sql<{ sku: string; qty: number }[]>`SELECT p.sku, l.qty::float8 AS qty FROM inv_bom_lines l JOIN inv_products p ON p.id = l.component_id WHERE l.bom_id = ${b.id} ORDER BY p.sku`;
    withCalc.push({ ...b, components: comps, unit: calculate(full, 1) }); }
  const orders = await sql<{ id: number; number: number; sku: string; qty: number; status: string; planned: { material: number; labor: number; overhead: number }; material: number; labor: number; overhead: number; started_on: string | null; done_on: string | null }[]>`
    SELECT o.id, o.number, p.sku, o.qty::float8 AS qty, o.status, o.planned, o.material::float8 AS material, o.labor::float8 AS labor, o.overhead::float8 AS overhead,
      to_char(o.started_on,'YYYY-MM-DD') AS started_on, to_char(o.done_on,'YYYY-MM-DD') AS done_on
    FROM inv_production_orders o JOIN inv_products p ON p.id = o.product_id WHERE o.company_id = ${companyId} ORDER BY o.number DESC LIMIT 50`;
  const [w] = await sql<{ b: number }[]>`SELECT COALESCE(SUM(l.debit - l.credit), 0)::float8 AS b FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id WHERE v.company_id = ${companyId} AND l.account_number = ${WIP}`;
  return { boms: withCalc, orders: orders.map((o) => ({ ...o, variance: o.status === 'done' ? variance(o.planned, { material: o.material, labor: o.labor, overhead: o.overhead }) : null })), wip: w.b };
}
