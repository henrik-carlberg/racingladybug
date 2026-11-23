import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { isReason, reasonStats, returnable, skuOf } from '@/lib/returns';
import type { Actor } from './actor';
import { date, int, str } from './input';
import { saveDraftTx } from './invoices';

type Db = Tx | typeof sql;

export interface CaseLine { id: number; description: string; quantity: number; unit: string; unit_price: number; vat_rate: number; product_id: number | null; product: string | null; disposition: string | null }
export interface Case { id: number; invoice_id: number; number: number; customer: string; opened_on: string; reason: string; note: string; status: string; closed_on: string | null; credit_invoice_id: number | null; credit_status: string | null; value: number; lines: CaseLine[] }

async function cases(db: Db, companyId: number, id?: number) {
  const rows = await db<Omit<Case, 'lines' | 'value'>[]>`SELECT r.id, r.invoice_id, i.invoice_number AS number, c.name AS customer, to_char(r.opened_on,'YYYY-MM-DD') AS opened_on, r.reason, r.note, r.status,
      to_char(r.closed_on,'YYYY-MM-DD') AS closed_on, r.credit_invoice_id, ci.status AS credit_status
    FROM return_cases r JOIN invoices i ON i.id = r.invoice_id JOIN customers c ON c.id = i.customer_id LEFT JOIN invoices ci ON ci.id = r.credit_invoice_id
    WHERE r.company_id = ${companyId} ${id ? db`AND r.id = ${id}` : db``} ORDER BY r.status = 'received' DESC, r.opened_on DESC, r.id DESC LIMIT 300`;
  if (!rows.length) return [];
  const lines = await db<(CaseLine & { case_id: number })[]>`SELECT l.case_id, l.id, l.description, l.quantity::float8 AS quantity, l.unit, l.unit_price::float8 AS unit_price, l.vat_rate, l.product_id,
      CASE WHEN p.id IS NULL THEN NULL ELSE p.sku || ' ' || p.name END AS product, l.disposition
    FROM return_lines l LEFT JOIN inv_products p ON p.id = l.product_id WHERE l.case_id IN ${db(rows.map((r) => r.id))} ORDER BY l.id`;
  return rows.map((r) => {
    const ls = lines.filter((l) => l.case_id === r.id);
    return { ...r, lines: ls, value: ls.reduce((s, l) => s + Math.round(l.quantity * l.unit_price), 0) };
  });
}

/** Fakturarader som kan returneras (antal minus det som redan ingår i returer som inte avslagits) */
export async function invoiceLines(companyId: number, invoiceId: number, db: Db = sql) {
  const [inv] = await db<{ id: number; number: number; customer: string; status: string; credit_of_id: number | null }[]>`SELECT i.id, i.invoice_number AS number, c.name AS customer, i.status, i.credit_of_id
    FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ${invoiceId} AND i.company_id = ${companyId}`;
  if (!inv) throw new NotFoundError('Fakturan');
  const lines = await db<{ id: number; description: string; quantity: number; unit: string; unit_price: number; vat_rate: number; account: number; returned: number }[]>`
    SELECT l.id, l.description, l.quantity::float8 AS quantity, l.unit, l.unit_price::float8 AS unit_price, l.vat_rate, l.account_number AS account,
      COALESCE((SELECT SUM(rl.quantity) FROM return_lines rl JOIN return_cases rc ON rc.id = rl.case_id WHERE rl.invoice_line_id = l.id AND rc.status <> 'rejected'), 0)::float8 AS returned
    FROM invoice_lines l WHERE l.invoice_id = ${invoiceId} AND l.quantity > 0 ORDER BY l.position`;
  const products = await db<{ id: number; sku: string }[]>`SELECT id, sku FROM inv_products WHERE company_id = ${companyId}`;
  const skus = products.map((p) => p.sku);
  return { invoice: inv, lines: lines.map((l) => { const sku = skuOf(l.description, skus); return { ...l, left: returnable(l.quantity, l.returned), product_id: sku ? products.find((p) => p.sku === sku)!.id : null }; }) };
}

export async function overview(companyId: number) {
  const list = await cases(sql, companyId);
  const invoices = await sql<{ id: number; number: number; customer: string; date: string }[]>`SELECT i.id, i.invoice_number AS number, c.name AS customer, to_char(i.invoice_date,'YYYY-MM-DD') AS date
    FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.company_id = ${companyId} AND i.status IN ('booked','paid') AND i.credit_of_id IS NULL AND i.total > 0
    ORDER BY i.invoice_date DESC, i.id DESC LIMIT 300`;
  const stats = reasonStats(list.flatMap((c) => c.lines.map((l) => ({ case_id: c.id, reason: c.reason, status: c.status, value: Math.round(l.quantity * l.unit_price), product: l.product, qty: c.status === 'rejected' ? 0 : l.quantity }))));
  const [wh] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM inv_products WHERE company_id = ${companyId}`;
  return { cases: list, invoices, stats, hasProducts: wh.n > 0 };
}

/** Kunden skickar tillbaka varor eller reklamerar – ett ärende med de rader och antal som berörs */
export async function openCase(actor: Actor, input: Record<string, unknown>) {
  const invoiceId = int(input, 'invoice_id', 'Faktura');
  const reason = str(input, 'reason', { required: true, label: 'Orsak' });
  if (!isReason(reason)) throw new ValidationError('Okänd orsak');
  const d = date(input, 'date', 'Datum');
  return sql.begin(async (tx) => {
    await tx`SELECT 1 FROM invoices WHERE id = ${invoiceId} AND company_id = ${actor.companyId} FOR UPDATE`;
    const { invoice, lines } = await invoiceLines(actor.companyId, invoiceId, tx);
    if (!['booked', 'paid'].includes(invoice.status) || invoice.credit_of_id) throw new ConflictError('Returer registreras mot bokförda fakturor som inte är krediterade');
    const picked = lines.map((l) => {
      const raw = String(input[`qty_${l.id}`] ?? '').trim().replace(',', '.');
      const q = raw ? Number(raw) : 0;
      if (!Number.isFinite(q) || q < 0 || Math.round(q * 1000) !== q * 1000) throw new ValidationError(`Ogiltigt antal för ${l.description}`);
      if (q > l.left + 1e-9) throw new ValidationError(`Högst ${l.left} ${l.unit} av ${l.description} kan returneras`);
      return { l, q };
    }).filter((x) => x.q > 0);
    if (!picked.length) throw new ValidationError('Ange antal för minst en rad som returneras');
    const [c] = await tx<{ id: number }[]>`INSERT INTO return_cases ${tx({ company_id: actor.companyId, invoice_id: invoiceId, opened_on: d, reason, note: str(input, 'note', { max: 1000 }), created_by: actor.userId })} RETURNING id`;
    await tx`INSERT INTO return_lines ${tx(picked.map(({ l, q }) => ({ case_id: c.id, invoice_line_id: l.id, description: l.description, quantity: q, unit: l.unit, unit_price: l.unit_price, vat_rate: l.vat_rate, account_number: l.account, product_id: l.product_id })))}`;
    await auditBy(tx, actor, 'return_opened', 'invoice', invoiceId, { case: c.id, reason });
    return c.id;
  });
}

const lockCase = async (tx: Tx, actor: Actor, id: number) => {
  const [x] = await tx<{ status: string }[]>`SELECT status FROM return_cases WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
  if (!x) throw new NotFoundError('Returärendet');
  if (x.status !== 'received') throw new ConflictError('Returärendet är redan avgjort');
  const [c] = await cases(tx, actor.companyId, id);
  return c;
};

/** Returnerade varor med artikel tas tillbaka i lager (till genomsnittligt anskaffningsvärde) eller kasseras */
async function dispose(tx: Tx, actor: Actor, c: Case, input: Record<string, unknown>, d: string): Promise<{ restocked: number; scrapped: number; warehouse?: number }> {
  const stocked = c.lines.filter((l) => l.product_id);
  if (!stocked.length) return { restocked: 0, scrapped: 0 };
  const { move, warehouseId } = await import('@/modules/lager/service');
  const wh = await warehouseId(tx, actor.companyId, input);
  let restocked = 0, scrapped = 0;
  for (const l of stocked) {
    const disp = input[`disposition_${l.id}`] === 'scrap' ? 'scrap' : 'restock';
    const [p] = await tx<{ avg_cost: number }[]>`SELECT avg_cost::float8 AS avg_cost FROM inv_products WHERE id = ${l.product_id}`;
    if (disp === 'restock') {
      await move(tx, actor, { product_id: l.product_id!, warehouse_id: wh, qty: l.quantity, type: 'adjustment', date: d, ref_type: 'return_case', ref_id: c.id, note: `Retur ${c.id}, faktura ${c.number}` });
      restocked += l.quantity;
    } else scrapped += l.quantity;
    await tx`UPDATE return_lines SET disposition = ${disp}, unit_cost = ${p?.avg_cost ?? 0} WHERE id = ${l.id}`;
  }
  return { restocked, scrapped, warehouse: wh };
}

/** Godkänd retur: kreditfakturautkast för de returnerade raderna (samma pris, moms och konto som fakturan) */
export async function credit(actor: Actor, id: number, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum');
  return sql.begin(async (tx) => {
    const c = await lockCase(tx, actor, id);
    const [inv] = await tx<{ customer_id: number }[]>`SELECT customer_id FROM invoices WHERE id = ${c.invoice_id}`;
    const acc = await tx<{ id: number; account: number }[]>`SELECT id, account_number AS account FROM return_lines WHERE case_id = ${id}`;
    const draft = await saveDraftTx(tx, actor, null, {
      customer_id: inv.customer_id, invoice_date: d, notes: `Kreditering av returnerade varor, faktura ${c.number} (returärende ${id})`,
      lines: c.lines.map((l) => ({ description: `Retur: ${l.description}`, quantity: -l.quantity, unit: l.unit, unit_price: l.unit_price, vat_rate: l.vat_rate, account: acc.find((a) => a.id === l.id)!.account })),
    });
    const stock = await dispose(tx, actor, c, input, d);
    await tx`UPDATE return_cases SET status = 'credited', closed_on = ${d}, credit_invoice_id = ${draft.id} WHERE id = ${id}`;
    await auditBy(tx, actor, 'return_credited', 'invoice', c.invoice_id, { case: id, credit_invoice: draft.id, ...stock });
    return { invoiceId: draft.id, ...stock };
  });
}

/** Ersättningsvara: ingen kreditering, en ny vara levereras ur lagret och den returnerade tas tillbaka eller kasseras */
export async function replace(actor: Actor, id: number, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum');
  return sql.begin(async (tx) => {
    const c = await lockCase(tx, actor, id);
    const stock = await dispose(tx, actor, c, input, d);
    let delivered = 0;
    const stocked = c.lines.filter((l) => l.product_id);
    if (stocked.length) {
      const { move } = await import('@/modules/lager/service');
      for (const l of stocked) {
        await move(tx, actor, { product_id: l.product_id!, warehouse_id: stock.warehouse!, qty: -l.quantity, type: 'delivery', date: d, ref_type: 'return_case', ref_id: id, note: `Ersättningsvara, retur ${id}` });
        delivered += l.quantity;
      }
    }
    await tx`UPDATE return_cases SET status = 'replaced', closed_on = ${d} WHERE id = ${id}`;
    await auditBy(tx, actor, 'return_replaced', 'invoice', c.invoice_id, { case: id, delivered, ...stock });
    return { delivered, ...stock };
  });
}

/** Reklamationen avslås – varan skickas tillbaka till kunden, inget bokförs */
export async function reject(actor: Actor, id: number, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum');
  const note = str(input, 'note', { required: true, label: 'Motivering', max: 1000 });
  return sql.begin(async (tx) => {
    const c = await lockCase(tx, actor, id);
    await tx`UPDATE return_cases SET status = 'rejected', closed_on = ${d}, note = ${c.note ? `${c.note}\nAvslag: ${note}` : `Avslag: ${note}`} WHERE id = ${id}`;
    await auditBy(tx, actor, 'return_rejected', 'invoice', c.invoice_id, { case: id });
  });
}
