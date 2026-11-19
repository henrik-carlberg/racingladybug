import 'server-only';
import { threeWayMatch } from '@/lib/purchasing';
import { blockedInvoices } from '@/lib/services/fraud';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { emit } from '@/lib/server/events';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { today } from '@/lib/format';
import type { Actor } from '@/lib/services/actor';
import { arr, date, int, optInt, str } from '@/lib/services/input';
import { saveDraftTx } from '@/lib/services/invoices';
import { registerSupplierInvoice } from '@/lib/services/suppliers';
import { inventoryValue, orderTotals, parseQty, q3, receiptStatus, reorderSuggestions, weightedAverage } from './calc';

type Db = Tx | typeof sql;
const INVENTORY = 1460, STOCK_CHANGE = 4960, PURCHASES = 4010;

// ---------- Lagerställen ----------

export async function warehouses(db: Db, companyId: number) {
  const rows = await db<{ id: number; name: string; address: string }[]>`SELECT id, name, address FROM inv_warehouses WHERE company_id = ${companyId} ORDER BY id`;
  if (rows.length) return rows;
  const [w] = await db<{ id: number; name: string; address: string }[]>`INSERT INTO inv_warehouses (company_id, name) VALUES (${companyId}, 'Huvudlager')
    ON CONFLICT (company_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id, name, address`;
  return [w];
}

export async function createWarehouse(actor: Actor, input: Record<string, unknown>) {
  try {
    const [w] = await sql<{ id: number }[]>`INSERT INTO inv_warehouses (company_id, name, address)
      VALUES (${actor.companyId}, ${str(input, 'name', { required: true, label: 'Namn' })}, ${str(input, 'address')}) RETURNING id`;
    await auditBy(sql, actor, 'create', 'inv.warehouse', w.id);
    return w;
  } catch (e) {
    if (String((e as Error).message).includes('inv_warehouses_company_id_name_key')) throw new ConflictError('Det finns redan ett lagerställe med det namnet');
    throw e;
  }
}

async function warehouseId(db: Db, companyId: number, input: Record<string, unknown>) {
  const id = optInt(input, 'warehouse_id', 'Lagerställe');
  const list = await warehouses(db, companyId);
  if (id == null) return list[0].id;
  if (!list.some((w) => w.id === id)) throw new ValidationError('Lagerstället finns inte');
  return id;
}

// ---------- Artiklar ----------

export interface ProductOut {
  id: number; object: 'inv.product'; sku: string; name: string; unit: string; purchase_price: number; avg_cost: number; sales_price: number; vat_rate: number;
  reorder_point: number; reorder_qty: number; supplier_id: number | null; supplier_name: string | null; supplier_sku: string; barcode: string; active: boolean;
  on_hand: number; on_order: number; reserved: number; available: number; value: number;
  stock: { warehouse_id: number; warehouse: string; qty: number }[];
}

const PCOLS = (db: Db, companyId: number) => db`p.id, 'inv.product' AS object, p.sku, p.name, p.unit, p.purchase_price::int AS purchase_price, p.avg_cost::float8 AS avg_cost,
  p.sales_price::int AS sales_price, p.vat_rate, p.reorder_point::float8 AS reorder_point, p.reorder_qty::float8 AS reorder_qty, p.supplier_id, s.name AS supplier_name,
  p.supplier_sku, p.barcode, p.active,
  COALESCE((SELECT SUM(qty) FROM inv_stock st WHERE st.product_id = p.id), 0)::float8 AS on_hand,
  COALESCE((SELECT SUM(l.qty - l.received) FROM inv_purchase_order_lines l JOIN inv_purchase_orders o ON o.id = l.order_id
    WHERE l.product_id = p.id AND o.company_id = ${companyId} AND o.status IN ('draft', 'sent', 'partial')), 0)::float8 AS on_order,
  COALESCE((SELECT SUM(l.qty) FROM inv_sales_order_lines l JOIN inv_sales_orders o ON o.id = l.order_id
    WHERE l.product_id = p.id AND o.company_id = ${companyId} AND o.status = 'open'), 0)::float8 AS reserved`;

async function enrich(db: Db, rows: Omit<ProductOut, 'available' | 'value' | 'stock'>[]): Promise<ProductOut[]> {
  if (!rows.length) return [];
  const stock = await db<{ product_id: number; warehouse_id: number; warehouse: string; qty: number }[]>`
    SELECT st.product_id, st.warehouse_id, w.name AS warehouse, st.qty::float8 AS qty FROM inv_stock st JOIN inv_warehouses w ON w.id = st.warehouse_id
    WHERE st.product_id IN ${db(rows.map((r) => r.id))} AND st.qty <> 0 ORDER BY w.id`;
  return rows.map((r) => ({
    ...r, available: q3(r.on_hand - r.reserved), value: Math.round(Math.max(0, r.on_hand) * r.avg_cost),
    stock: stock.filter((s) => s.product_id === r.id).map(({ warehouse_id, warehouse, qty }) => ({ warehouse_id, warehouse, qty })),
  }));
}

export async function listProducts(companyId: number, f: { q?: string; active?: boolean } = {}): Promise<ProductOut[]> {
  const rows = await sql<Omit<ProductOut, 'available' | 'value' | 'stock'>[]>`SELECT ${PCOLS(sql, companyId)}
    FROM inv_products p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.company_id = ${companyId}
    ${f.active != null ? sql`AND p.active = ${f.active}` : sql``}
    ${f.q ? sql`AND (p.sku ILIKE ${'%' + f.q + '%'} OR p.name ILIKE ${'%' + f.q + '%'})` : sql``}
    ORDER BY p.active DESC, p.sku`;
  return enrich(sql, rows);
}

export async function getProduct(companyId: number, id: number, db: Db = sql): Promise<ProductOut> {
  const rows = await db<Omit<ProductOut, 'available' | 'value' | 'stock'>[]>`SELECT ${PCOLS(db, companyId)}
    FROM inv_products p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.company_id = ${companyId} AND p.id = ${id}`;
  if (!rows.length) throw new NotFoundError('Artikeln');
  return (await enrich(db, rows))[0];
}

export async function productMovements(companyId: number, productId: number) {
  return sql<{ id: number; date: string; type: string; qty: number; unit_cost: number; warehouse: string; ref_type: string | null; ref_id: number | null; note: string; user: string }[]>`
    SELECT m.id, to_char(m.date,'YYYY-MM-DD') AS date, m.type, m.qty::float8 AS qty, m.unit_cost::float8 AS unit_cost, w.name AS warehouse, m.ref_type, m.ref_id, m.note, u.name AS user
    FROM inv_movements m JOIN inv_warehouses w ON w.id = m.warehouse_id JOIN users u ON u.id = m.created_by
    WHERE m.company_id = ${companyId} AND m.product_id = ${productId} ORDER BY m.date DESC, m.id DESC LIMIT 200`;
}

const ore = (input: Record<string, unknown>, k: string, label: string) => {
  const v = optInt(input, k, label);
  if (v != null && v < 0) throw new ValidationError(`${label} kan inte vara negativt`);
  return v;
};

export async function saveProduct(actor: Actor, id: number | null, input: Record<string, unknown>): Promise<ProductOut> {
  const vat = optInt(input, 'vat_rate', 'Moms') ?? 25;
  if (![0, 6, 12, 25].includes(vat)) throw new ValidationError('Momssats måste vara 0, 6, 12 eller 25');
  const supplierId = optInt(input, 'supplier_id', 'Leverantör');
  if (supplierId) {
    const [s] = await sql`SELECT 1 FROM suppliers WHERE id = ${supplierId} AND company_id = ${actor.companyId}`;
    if (!s) throw new ValidationError('Leverantören finns inte');
  }
  const fields = {
    sku: str(input, 'sku', { required: true, label: 'Artikelnummer' }), name: str(input, 'name', { required: true, label: 'Benämning' }),
    unit: str(input, 'unit') || 'st', purchase_price: ore(input, 'purchase_price', 'Inköpspris') ?? 0, sales_price: ore(input, 'sales_price', 'Försäljningspris') ?? 0,
    vat_rate: vat, reorder_point: parseQty(input.reorder_point) ?? 0, reorder_qty: parseQty(input.reorder_qty) ?? 0,
    supplier_id: supplierId, supplier_sku: str(input, 'supplier_sku'), barcode: str(input, 'barcode').replace(/\s/g, '').slice(0, 40), active: input.active == null ? true : input.active === true || input.active === 'true' || input.active === 'on',
  };
  try {
    return await sql.begin(async (tx) => {
      let pid = id ?? 0;
      if (id) {
        const r = await tx`UPDATE inv_products SET ${tx(fields)} WHERE id = ${id} AND company_id = ${actor.companyId} RETURNING id`;
        if (!r.length) throw new NotFoundError('Artikeln');
      } else {
        [{ id: pid }] = await tx<{ id: number }[]>`INSERT INTO inv_products ${tx({ ...fields, company_id: actor.companyId, avg_cost: fields.purchase_price })} RETURNING id`;
        const opening = parseQty(input.opening_qty);
        if (opening && opening > 0) {
          await move(tx, actor, { product_id: pid, warehouse_id: await warehouseId(tx, actor.companyId, input), qty: opening, unit_cost: fields.purchase_price,
            type: 'opening', date: str(input, 'opening_date') || today(), note: 'Ingående lager' });
        }
      }
      await auditBy(tx, actor, id ? 'update' : 'create', 'inv.product', pid);
      return getProduct(actor.companyId, pid, tx);
    });
  } catch (e) {
    if (String((e as Error).message).includes('inv_products_company_id_sku_key')) throw new ConflictError('Artikelnumret finns redan');
    throw e;
  }
}

// ---------- Lagerrörelser ----------

interface MoveIn { product_id: number; warehouse_id: number; qty: number; unit_cost?: number; type: 'opening' | 'receipt' | 'delivery' | 'adjustment' | 'transfer'; date: string; ref_type?: string; ref_id?: number; note?: string }

/** Bokför en lagerrörelse. Inleveranser uppdaterar det vägda genomsnittspriset. Uttag får inte göra saldot negativt. */
async function move(tx: Tx, actor: Actor, m: MoveIn) {
  const [p] = await tx<{ avg_cost: number; on_hand: number; sku: string }[]>`SELECT p.avg_cost::float8 AS avg_cost, p.sku,
    COALESCE((SELECT SUM(qty) FROM inv_stock WHERE product_id = p.id), 0)::float8 AS on_hand
    FROM inv_products p WHERE p.id = ${m.product_id} AND p.company_id = ${actor.companyId} FOR UPDATE`;
  if (!p) throw new ValidationError('Artikeln finns inte');
  if (m.qty < 0) {
    const [st] = await tx<{ qty: number }[]>`SELECT qty::float8 AS qty FROM inv_stock WHERE product_id = ${m.product_id} AND warehouse_id = ${m.warehouse_id}`;
    if ((st?.qty ?? 0) + m.qty < -0.0005) throw new ValidationError(`Det finns bara ${st?.qty ?? 0} av ${p.sku} i lagret`);
  }
  let cost = m.unit_cost ?? p.avg_cost;
  if (m.qty > 0 && (m.type === 'receipt' || m.type === 'opening')) {
    const avg = weightedAverage(p.on_hand, p.avg_cost, m.qty, cost);
    await tx`UPDATE inv_products SET avg_cost = ${avg} WHERE id = ${m.product_id}`;
  } else if (m.type !== 'transfer') {
    cost = p.avg_cost;
  }
  await tx`INSERT INTO inv_stock (product_id, warehouse_id, qty) VALUES (${m.product_id}, ${m.warehouse_id}, ${m.qty})
    ON CONFLICT (product_id, warehouse_id) DO UPDATE SET qty = inv_stock.qty + EXCLUDED.qty`;
  await tx`INSERT INTO inv_movements ${tx({
    company_id: actor.companyId, product_id: m.product_id, warehouse_id: m.warehouse_id, date: m.date, qty: m.qty, unit_cost: cost, type: m.type,
    ref_type: m.ref_type ?? null, ref_id: m.ref_id ?? null, note: m.note ?? '', created_by: actor.userId,
  })}`;
}

/** Flytt mellan lagerställen */
export async function transfer(actor: Actor, input: Record<string, unknown>) {
  const qty = parseQty(input.qty);
  if (!qty || qty <= 0) throw new ValidationError('Ange antal');
  const from = int(input, 'from_warehouse_id', 'Från lager'), to = int(input, 'to_warehouse_id', 'Till lager');
  if (from === to) throw new ValidationError('Välj två olika lagerställen');
  return sql.begin(async (tx) => {
    const list = await warehouses(tx, actor.companyId);
    if (!list.some((w) => w.id === from) || !list.some((w) => w.id === to)) throw new ValidationError('Lagerstället finns inte');
    const pid = int(input, 'product_id', 'Artikel');
    const d = date(input, 'date', 'Datum', false) || today();
    await move(tx, actor, { product_id: pid, warehouse_id: from, qty: -qty, type: 'transfer', date: d, note: str(input, 'note') });
    await move(tx, actor, { product_id: pid, warehouse_id: to, qty, type: 'transfer', date: d, note: str(input, 'note') });
    await auditBy(tx, actor, 'transfer', 'inv.product', pid, { from, to, qty });
    return getProduct(actor.companyId, pid, tx);
  });
}

/** Inventering: räknade antal per artikel i ett lagerställe → justeringar för skillnaderna */
export async function applyCount(actor: Actor, input: Record<string, unknown>) {
  const rows = arr(input, 'counts', 'Inventering');
  return sql.begin(async (tx) => {
    const wid = await warehouseId(tx, actor.companyId, input);
    const d = date(input, 'date', 'Datum', false) || today();
    let changed = 0;
    for (const r of rows) {
      const counted = parseQty(r.counted);
      if (counted == null) continue;
      if (counted < 0) throw new ValidationError('Räknat antal kan inte vara negativt');
      const pid = int(r, 'product_id', 'Artikel');
      const [st] = await tx<{ qty: number }[]>`SELECT qty::float8 AS qty FROM inv_stock WHERE product_id = ${pid} AND warehouse_id = ${wid}`;
      const diff = q3(counted - (st?.qty ?? 0));
      if (diff === 0) continue;
      await move(tx, actor, { product_id: pid, warehouse_id: wid, qty: diff, type: 'adjustment', date: d, ref_type: 'count', note: str(input, 'note') || 'Inventering' });
      changed++;
    }
    await auditBy(tx, actor, 'count', 'inv.warehouse', wid, { changed });
    return { changed };
  });
}

// ---------- Inköpsorder ----------

export interface POOut {
  id: number; object: 'inv.purchase_order'; number: number; supplier_id: number; supplier_name: string; warehouse_id: number; warehouse: string;
  order_date: string; expected_date: string | null; status: 'draft' | 'sent' | 'partial' | 'received' | 'cancelled'; notes: string; supplier_invoice_id: number | null;
  lines: { id: number; product_id: number; sku: string; name: string; unit: string; supplier_sku: string; qty: number; unit_price: number; received: number; vat_rate: number; amount: number }[];
  net: number; vat: number; total: number;
}

export async function getPO(companyId: number, id: number, db: Db = sql): Promise<POOut> {
  const [o] = await db<Omit<POOut, 'object' | 'lines' | 'net' | 'vat' | 'total'>[]>`
    SELECT o.id, o.number, o.supplier_id, s.name AS supplier_name, o.warehouse_id, w.name AS warehouse, to_char(o.order_date,'YYYY-MM-DD') AS order_date,
      to_char(o.expected_date,'YYYY-MM-DD') AS expected_date, o.status, o.notes, o.supplier_invoice_id
    FROM inv_purchase_orders o JOIN suppliers s ON s.id = o.supplier_id JOIN inv_warehouses w ON w.id = o.warehouse_id
    WHERE o.id = ${id} AND o.company_id = ${companyId}`;
  if (!o) throw new NotFoundError('Inköpsordern');
  const lines = (await db<Omit<POOut['lines'][number], 'amount'>[]>`
    SELECT l.id, l.product_id, p.sku, p.name, p.unit, p.supplier_sku, l.qty::float8 AS qty, l.unit_price::int AS unit_price, l.received::float8 AS received, p.vat_rate
    FROM inv_purchase_order_lines l JOIN inv_products p ON p.id = l.product_id WHERE l.order_id = ${id} ORDER BY l.id`).map((l) => ({ ...l, amount: Math.round(l.qty * l.unit_price) }));
  return { ...o, object: 'inv.purchase_order', lines, ...orderTotals(lines) };
}

export async function listPOs(companyId: number, f: { status?: string } = {}) {
  const ids = await sql<{ id: number }[]>`SELECT id FROM inv_purchase_orders WHERE company_id = ${companyId} ${f.status ? sql`AND status = ${f.status}` : sql``} ORDER BY number DESC LIMIT 200`;
  return Promise.all(ids.map((r) => getPO(companyId, r.id)));
}

async function nextNumber(tx: Tx, table: 'inv_purchase_orders' | 'inv_sales_orders', companyId: number) {
  await tx`SELECT pg_advisory_xact_lock(${companyId}, ${table === 'inv_purchase_orders' ? 1 : 2})`;
  const [{ n }] = await tx<{ n: number }[]>`SELECT COALESCE(MAX(number), 0)::int + 1 AS n FROM ${tx(table)} WHERE company_id = ${companyId}`;
  return n;
}

function parseLines(input: Record<string, unknown>) {
  const lines = arr(input, 'lines', 'Orderrader').map((r, i) => {
    const qty = parseQty(r.qty);
    if (!qty || qty <= 0) throw new ValidationError(`Rad ${i + 1}: ange antal`);
    return { product_id: int(r, 'product_id', `Rad ${i + 1}: artikel`), qty, unit_price: optInt(r, 'unit_price', `Rad ${i + 1}: pris`) };
  });
  if (!lines.length) throw new ValidationError('Ordern måste ha minst en rad');
  return lines;
}

export async function createPO(actor: Actor, input: Record<string, unknown>): Promise<POOut> {
  const supplierId = int(input, 'supplier_id', 'Leverantör');
  const lines = parseLines(input);
  return sql.begin(async (tx) => {
    const [s] = await tx`SELECT 1 FROM suppliers WHERE id = ${supplierId} AND company_id = ${actor.companyId}`;
    if (!s) throw new ValidationError('Leverantören finns inte');
    const wid = await warehouseId(tx, actor.companyId, input);
    const number = await nextNumber(tx, 'inv_purchase_orders', actor.companyId);
    const [{ id }] = await tx<{ id: number }[]>`INSERT INTO inv_purchase_orders ${tx({
      company_id: actor.companyId, number, supplier_id: supplierId, warehouse_id: wid, order_date: date(input, 'order_date', 'Orderdatum', false) || today(),
      expected_date: date(input, 'expected_date', 'Leveransdatum', false) || null, notes: str(input, 'notes'), created_by: actor.userId,
    })} RETURNING id`;
    for (const l of lines) {
      const [p] = await tx<{ purchase_price: number }[]>`SELECT purchase_price::int AS purchase_price FROM inv_products WHERE id = ${l.product_id} AND company_id = ${actor.companyId}`;
      if (!p) throw new ValidationError('Artikeln finns inte');
      await tx`INSERT INTO inv_purchase_order_lines (order_id, product_id, qty, unit_price) VALUES (${id}, ${l.product_id}, ${l.qty}, ${l.unit_price ?? p.purchase_price})`;
    }
    await auditBy(tx, actor, 'create', 'inv.purchase_order', id, { number });
    const out = await getPO(actor.companyId, id, tx);
    await emit(tx, actor.companyId, 'lager.purchase_order.created', out);
    return out;
  });
}

export async function setPOStatus(actor: Actor, id: number, status: 'sent' | 'cancelled') {
  return sql.begin(async (tx) => {
    const o = await getPO(actor.companyId, id, tx);
    if (status === 'sent' && o.status !== 'draft') throw new ConflictError('Ordern är redan skickad');
    if (status === 'cancelled' && (o.lines.some((l) => l.received > 0) || o.status === 'cancelled')) throw new ConflictError('Ordern har inleveranser och kan inte makuleras');
    await tx`UPDATE inv_purchase_orders SET status = ${status} WHERE id = ${id}`;
    await auditBy(tx, actor, status === 'sent' ? 'send' : 'cancel', 'inv.purchase_order', id);
    return getPO(actor.companyId, id, tx);
  });
}

/** Inleverans: lines = [{ line_id, qty }]; utan lines tas allt som återstår emot */
export async function receivePO(actor: Actor, id: number, input: Record<string, unknown>): Promise<POOut> {
  return sql.begin(async (tx) => {
    await tx`SELECT id FROM inv_purchase_orders WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
    const o = await getPO(actor.companyId, id, tx);
    if (o.status === 'cancelled' || o.status === 'received') throw new ConflictError('Ordern är redan helt inlevererad eller makulerad');
    const d = date(input, 'date', 'Datum', false) || today();
    const given = input.lines == null ? null : new Map(arr(input, 'lines', 'Rader').map((r) => [int(r, 'line_id', 'Rad'), parseQty(r.qty) ?? 0]));
    let any = false;
    for (const l of o.lines) {
      const rest = q3(l.qty - l.received);
      const qty = given ? Math.min(given.get(l.id) ?? 0, rest) : rest;
      if (qty <= 0) continue;
      await move(tx, actor, { product_id: l.product_id, warehouse_id: o.warehouse_id, qty, unit_cost: l.unit_price, type: 'receipt', date: d, ref_type: 'purchase_order', ref_id: id, note: `Inköpsorder ${o.number}` });
      await tx`UPDATE inv_purchase_order_lines SET received = received + ${qty} WHERE id = ${l.id}`;
      await tx`UPDATE inv_products SET purchase_price = ${l.unit_price} WHERE id = ${l.product_id}`;
      any = true;
    }
    if (!any) throw new ValidationError('Ange antal att ta emot');
    const after = await getPO(actor.companyId, id, tx);
    await tx`UPDATE inv_purchase_orders SET status = ${receiptStatus(after.lines)} WHERE id = ${id}`;
    await auditBy(tx, actor, 'receive', 'inv.purchase_order', id);
    return getPO(actor.companyId, id, tx);
  });
}

/** Leverantörsfaktura från inköpsordern (inlevererade antal), konterad på inköp av varor */
export async function invoicePO(actor: Actor, id: number, input: Record<string, unknown>) {
  const o = await getPO(actor.companyId, id);
  if (o.supplier_invoice_id) throw new ConflictError('Det finns redan en leverantörsfaktura för ordern');
  const lines = o.lines.map((l) => ({ ...l, qty: l.received })).filter((l) => l.qty > 0);
  if (!lines.length) throw new ValidationError('Ta emot leveransen innan fakturan registreras');
  const t = orderTotals(lines);
  const total = optInt(input, 'total', 'Fakturans totalbelopp') ?? t.total;
  const vat = optInt(input, 'vat', 'Moms') ?? t.vat;
  await ensureAccounts(sql, actor.companyId);
  const si = await registerSupplierInvoice(actor, {
    supplier_id: o.supplier_id, invoice_number: str(input, 'invoice_number', { required: true, label: 'Leverantörens fakturanummer' }),
    invoice_date: str(input, 'invoice_date') || today(), due_date: str(input, 'due_date'), total, vat,
    description: `Inköpsorder ${o.number}`, lines: [{ account: PURCHASES, amount: total - vat, description: `Varor enligt inköpsorder ${o.number}` }],
  });
  await auditBy(sql, actor, 'invoice', 'inv.purchase_order', id, { supplier_invoice: si.id });
  await matchInvoice(actor, id, si.id);
  return si;
}

/**
 * Trevägsmatchning: leverantörsfakturan kopplas till inköpsordern och jämförs med det som har levererats.
 * Stämmer den och bolaget har slagit på automatisk attest blir fakturan attesterad direkt.
 */
export async function matchInvoice(actor: Actor, poId: number, siId: number) {
  return sql.begin(async (tx) => {
    await tx`SELECT id FROM inv_purchase_orders WHERE id = ${poId} AND company_id = ${actor.companyId} FOR UPDATE`;
    const o = await getPO(actor.companyId, poId, tx);
    const [si] = await tx<{ supplier_id: number; status: string; net: number; po: number | null }[]>`SELECT supplier_id, status, (total - vat)::float8 AS net, purchase_order_id AS po
      FROM supplier_invoices WHERE id = ${siId} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!si) throw new NotFoundError('Leverantörsfakturan');
    if (si.supplier_id !== o.supplier_id) throw new ValidationError('Fakturan är från en annan leverantör än ordern');
    if (si.po && si.po !== poId) throw new ConflictError('Fakturan är redan kopplad till en annan inköpsorder');
    if (o.supplier_invoice_id && o.supplier_invoice_id !== siId) throw new ConflictError('Ordern har redan en annan leverantörsfaktura');
    const m = threeWayMatch({ lines: o.lines, invoiceNet: si.net });
    await tx`UPDATE inv_purchase_orders SET supplier_invoice_id = ${siId} WHERE id = ${poId}`;
    await tx`UPDATE supplier_invoices SET purchase_order_id = ${poId}, match_status = ${m.status} WHERE id = ${siId}`;
    let approved = false;
    const [co] = await tx<{ auto: boolean }[]>`SELECT auto_attest_matched AS auto FROM companies WHERE id = ${actor.companyId}`;
    if (m.status === 'matched' && co.auto && si.status === 'booked' && !(await blockedInvoices(tx, actor.companyId, [siId], { forPayment: false })).size) {
      await tx`UPDATE supplier_invoices SET status = 'approved', approved_at = now(), auto_approved = true WHERE id = ${siId}`;
      approved = true;
    }
    await auditBy(tx, actor, approved ? 'auto_approve' : 'match', 'supplier_invoice', siId, { po: poId, match: m.status, diff: m.diff });
    return { ...m, approved };
  });
}

/** Öppna inköpsorder hos leverantören som en faktura kan kopplas till */
export async function openPOsFor(companyId: number, supplierId: number) {
  return [...await sql<{ id: number; number: number; order_date: string; status: string }[]>`SELECT id, number, to_char(order_date,'YYYY-MM-DD') AS order_date, status FROM inv_purchase_orders
    WHERE company_id = ${companyId} AND supplier_id = ${supplierId} AND status IN ('sent','partial','received') AND supplier_invoice_id IS NULL ORDER BY number DESC LIMIT 20`];
}

/** Beställningsförslag och inköpsorder per leverantör */
export async function suggestions(companyId: number) {
  const products = await listProducts(companyId, { active: true });
  return reorderSuggestions(products.map((p) => ({ ...p })));
}

export async function createSuggestedPOs(actor: Actor): Promise<number[]> {
  const list = (await suggestions(actor.companyId)).filter((s) => s.supplier_id);
  const bySupplier = new Map<number, typeof list>();
  for (const s of list) bySupplier.set(s.supplier_id!, [...(bySupplier.get(s.supplier_id!) ?? []), s]);
  const ids: number[] = [];
  for (const [supplier_id, items] of bySupplier) {
    ids.push((await createPO(actor, { supplier_id, notes: 'Skapad från beställningsförslag', lines: items.map((i) => ({ product_id: i.id, qty: i.suggested })) })).id);
  }
  return ids;
}

// ---------- Kundorder och leverans ----------

export interface SOOut {
  id: number; object: 'inv.sales_order'; number: number; customer_id: number; customer_name: string; warehouse_id: number; warehouse: string; order_date: string;
  status: 'open' | 'shipped' | 'invoiced' | 'cancelled'; delivery_address: string; your_reference: string; carrier: string; tracking: string; shipped_date: string | null;
  invoice_id: number | null; notes: string; customer_address: string;
  lines: { id: number; product_id: number; sku: string; name: string; unit: string; qty: number; unit_price: number; vat_rate: number; amount: number; in_stock: number }[];
  net: number; vat: number; total: number;
}

export async function getSO(companyId: number, id: number, db: Db = sql): Promise<SOOut> {
  const [o] = await db<Omit<SOOut, 'object' | 'lines' | 'net' | 'vat' | 'total'>[]>`
    SELECT o.id, o.number, o.customer_id, c.name AS customer_name, o.warehouse_id, w.name AS warehouse, to_char(o.order_date,'YYYY-MM-DD') AS order_date, o.status,
      o.delivery_address, o.your_reference, o.carrier, o.tracking, to_char(o.shipped_date,'YYYY-MM-DD') AS shipped_date, o.invoice_id, o.notes,
      concat_ws(', ', NULLIF(c.address, ''), NULLIF(trim(c.postal_code || ' ' || c.city), '')) AS customer_address
    FROM inv_sales_orders o JOIN customers c ON c.id = o.customer_id JOIN inv_warehouses w ON w.id = o.warehouse_id
    WHERE o.id = ${id} AND o.company_id = ${companyId}`;
  if (!o) throw new NotFoundError('Kundordern');
  const lines = (await db<Omit<SOOut['lines'][number], 'amount'>[]>`
    SELECT l.id, l.product_id, p.sku, p.name, p.unit, l.qty::float8 AS qty, l.unit_price::int AS unit_price, p.vat_rate,
      COALESCE((SELECT qty FROM inv_stock WHERE product_id = p.id AND warehouse_id = ${o.warehouse_id}), 0)::float8 AS in_stock
    FROM inv_sales_order_lines l JOIN inv_products p ON p.id = l.product_id WHERE l.order_id = ${id} ORDER BY l.id`).map((l) => ({ ...l, amount: Math.round(l.qty * l.unit_price) }));
  return { ...o, object: 'inv.sales_order', lines, ...orderTotals(lines) };
}

export async function listSOs(companyId: number, f: { status?: string } = {}) {
  const ids = await sql<{ id: number }[]>`SELECT id FROM inv_sales_orders WHERE company_id = ${companyId} ${f.status ? sql`AND status = ${f.status}` : sql``} ORDER BY number DESC LIMIT 200`;
  return Promise.all(ids.map((r) => getSO(companyId, r.id)));
}

export async function createSO(actor: Actor, input: Record<string, unknown>): Promise<SOOut> {
  const customerId = int(input, 'customer_id', 'Kund');
  const lines = parseLines(input);
  return sql.begin(async (tx) => {
    const [c] = await tx`SELECT 1 FROM customers WHERE id = ${customerId} AND company_id = ${actor.companyId}`;
    if (!c) throw new ValidationError('Kunden finns inte');
    const wid = await warehouseId(tx, actor.companyId, input);
    const number = await nextNumber(tx, 'inv_sales_orders', actor.companyId);
    const [{ id }] = await tx<{ id: number }[]>`INSERT INTO inv_sales_orders ${tx({
      company_id: actor.companyId, number, customer_id: customerId, warehouse_id: wid, order_date: date(input, 'order_date', 'Orderdatum', false) || today(),
      delivery_address: str(input, 'delivery_address'), your_reference: str(input, 'your_reference'), notes: str(input, 'notes'), created_by: actor.userId,
    })} RETURNING id`;
    for (const l of lines) {
      const [p] = await tx<{ sales_price: number }[]>`SELECT sales_price::int AS sales_price FROM inv_products WHERE id = ${l.product_id} AND company_id = ${actor.companyId}`;
      if (!p) throw new ValidationError('Artikeln finns inte');
      await tx`INSERT INTO inv_sales_order_lines (order_id, product_id, qty, unit_price) VALUES (${id}, ${l.product_id}, ${l.qty}, ${l.unit_price ?? p.sales_price})`;
    }
    await auditBy(tx, actor, 'create', 'inv.sales_order', id, { number });
    const out = await getSO(actor.companyId, id, tx);
    await emit(tx, actor.companyId, 'lager.sales_order.created', out);
    return out;
  });
}

/** Leverans: plockas från lagret, frakt och spårningsnummer sparas */
export async function shipSO(actor: Actor, id: number, input: Record<string, unknown>): Promise<SOOut> {
  return sql.begin(async (tx) => {
    await tx`SELECT id FROM inv_sales_orders WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
    const o = await getSO(actor.companyId, id, tx);
    if (o.status !== 'open') throw new ConflictError('Ordern är redan levererad eller makulerad');
    const d = date(input, 'date', 'Leveransdatum', false) || today();
    for (const l of o.lines) {
      await move(tx, actor, { product_id: l.product_id, warehouse_id: o.warehouse_id, qty: -l.qty, type: 'delivery', date: d, ref_type: 'sales_order', ref_id: id, note: `Kundorder ${o.number}` });
    }
    await tx`UPDATE inv_sales_orders SET status = 'shipped', shipped_date = ${d}, carrier = ${str(input, 'carrier')}, tracking = ${str(input, 'tracking')} WHERE id = ${id}`;
    await auditBy(tx, actor, 'ship', 'inv.sales_order', id);
    const out = await getSO(actor.companyId, id, tx);
    await emit(tx, actor.companyId, 'lager.sales_order.shipped', out);
    return out;
  });
}

/** Fakturautkast från levererad kundorder */
export async function invoiceSO(actor: Actor, id: number, input: Record<string, unknown> = {}) {
  return sql.begin(async (tx) => {
    await tx`SELECT id FROM inv_sales_orders WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
    const o = await getSO(actor.companyId, id, tx);
    if (o.status !== 'shipped') throw new ConflictError(o.status === 'invoiced' ? 'Ordern är redan fakturerad' : 'Leverera ordern innan den faktureras');
    const inv = await saveDraftTx(tx, actor, null, {
      customer_id: o.customer_id, invoice_date: str(input, 'invoice_date') || today(), delivery_date: o.shipped_date ?? '', your_reference: o.your_reference,
      notes: `Kundorder ${o.number}${o.tracking ? `. Sändning ${o.carrier} ${o.tracking}` : ''}.`,
      lines: o.lines.map((l) => ({ description: `${l.sku} ${l.name}`, quantity: l.qty, unit: l.unit, unit_price: l.unit_price, vat_rate: l.vat_rate })),
    });
    await tx`UPDATE inv_sales_orders SET status = 'invoiced', invoice_id = ${inv.id} WHERE id = ${id}`;
    await auditBy(tx, actor, 'invoice', 'inv.sales_order', id, { invoice: inv.id });
    return inv;
  });
}

export async function cancelSO(actor: Actor, id: number) {
  const r = await sql`UPDATE inv_sales_orders SET status = 'cancelled' WHERE id = ${id} AND company_id = ${actor.companyId} AND status = 'open' RETURNING id`;
  if (!r.length) throw new ConflictError('Bara öppna order kan makuleras');
  await auditBy(sql, actor, 'cancel', 'inv.sales_order', id);
  return getSO(actor.companyId, id);
}

// ---------- Lagervärdering ----------

async function ensureAccounts(db: Db, companyId: number) {
  await db`INSERT INTO accounts (company_id, number, name) VALUES
    (${companyId}, ${INVENTORY}, 'Lager av handelsvaror'), (${companyId}, ${STOCK_CHANGE}, 'Förändring av lager av handelsvaror'), (${companyId}, ${PURCHASES}, 'Inköp material och varor')
    ON CONFLICT (company_id, number) DO NOTHING`;
}

export async function valuation(companyId: number, at = today(), use97 = false) {
  const items = await sql<{ qty: number; avg_cost: number }[]>`SELECT COALESCE(SUM(st.qty), 0)::float8 AS qty, p.avg_cost::float8 AS avg_cost
    FROM inv_products p LEFT JOIN inv_stock st ON st.product_id = p.id WHERE p.company_id = ${companyId} GROUP BY p.id`;
  const v = inventoryValue(items, use97);
  const [b] = await sql<{ balance: number }[]>`SELECT COALESCE(SUM(l.debit - l.credit), 0)::bigint AS balance FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${companyId} AND l.account_number = ${INVENTORY} AND v.date <= ${at}`;
  const history = await sql<{ date: string; cost_value: number; book_value: number; voucher_id: number | null }[]>`
    SELECT to_char(date,'YYYY-MM-DD') AS date, cost_value::bigint AS cost_value, book_value::bigint AS book_value, voucher_id FROM inv_valuations
    WHERE company_id = ${companyId} ORDER BY date DESC, id DESC LIMIT 20`;
  return { ...v, booked: Number(b.balance), change: v.book - Number(b.balance), date: at, history: history.map((h) => ({ ...h, cost_value: Number(h.cost_value), book_value: Number(h.book_value) })) };
}

/** Bokför lagerförändringen så att konto 1460 motsvarar lagervärdet (normalt på bokslutsdagen) */
export async function bookValuation(actor: Actor, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum');
  const use97 = input.use97 === true || input.use97 === 'on' || input.use97 === 'true';
  const v = await valuation(actor.companyId, d, use97);
  return sql.begin(async (tx) => {
    await ensureAccounts(tx, actor.companyId);
    let voucherId: number | null = null;
    if (v.change !== 0) {
      voucherId = (await createVoucher(tx, {
        actor, date: d, description: `Lagervärdering ${d}${use97 ? ' (97 %-regeln)' : ''}`, sourceType: 'inventory',
        lines: fromSigned([{ account: INVENTORY, amount: v.change }, { account: STOCK_CHANGE, amount: -v.change }]),
      })).id;
    }
    await tx`INSERT INTO inv_valuations ${tx({ company_id: actor.companyId, date: d, cost_value: v.cost, book_value: v.book, voucher_id: voucherId, created_by: actor.userId })}`;
    await auditBy(tx, actor, 'valuation', 'inv.valuation', voucherId ?? 0, { cost: v.cost, book: v.book, change: v.change });
    return { ...v, voucher_id: voucherId };
  });
}
