import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { AT_RESELLER, COST, STOCK, onHand, returnLines, shipLines, soldLines } from '@/lib/consignment';
import type { Actor } from './actor';
import { date, int, str } from './input';
import { saveDraftTx } from './invoices';

async function ensure(tx: Tx, companyId: number) {
  await tx`INSERT INTO accounts (company_id, number, name) VALUES (${companyId}, ${STOCK}, 'Lager av handelsvaror'), (${companyId}, ${AT_RESELLER}, 'Varulager hos återförsäljare (konsignation)'),
    (${companyId}, ${COST}, 'Lagerförändring och varukostnad') ON CONFLICT DO NOTHING`;
}

export async function overview(companyId: number) {
  const items = await sql<{ id: number; customer_id: number; customer: string; article: string; unit_cost: number; unit_price: number; vat_rate: number }[]>`SELECT i.id, i.customer_id, c.name AS customer, i.article,
    i.unit_cost::float8 AS unit_cost, i.unit_price::float8 AS unit_price, i.vat_rate FROM consignment_items i JOIN customers c ON c.id = i.customer_id WHERE i.company_id = ${companyId} ORDER BY c.name, i.article`;
  const moves = items.length ? await sql<{ item_id: number; kind: 'ship' | 'return' | 'sold'; qty: number }[]>`SELECT item_id, kind, qty FROM consignment_moves WHERE item_id IN ${sql(items.map((i) => i.id))}` : [];
  const rows = items.map((i) => { const q = onHand(moves.filter((m) => m.item_id === i.id)); return { ...i, onHand: q, value: q * i.unit_cost }; });
  const customers = await sql<{ id: number; name: string }[]>`SELECT id, name FROM customers WHERE company_id = ${companyId} ORDER BY name`;
  return { rows, customers, total: rows.reduce((s, r) => s + r.value, 0) };
}

export async function addItem(actor: Actor, input: Record<string, unknown>) {
  const customerId = int(input, 'customer_id', 'Återförsäljare');
  const [c] = await sql`SELECT 1 FROM customers WHERE id = ${customerId} AND company_id = ${actor.companyId}`;
  if (!c) throw new NotFoundError('Återförsäljaren');
  const cost = parseAmount(str(input, 'unit_cost')), price = parseAmount(str(input, 'unit_price'));
  if (cost == null || cost < 0 || price == null || price <= 0) throw new ValidationError('Ange inköpspris och försäljningspris per styck i kronor');
  const vat = Number(str(input, 'vat_rate') || '25');
  if (![0, 6, 12, 25].includes(vat)) throw new ValidationError('Välj momssats');
  try {
    await sql`INSERT INTO consignment_items ${sql({ company_id: actor.companyId, customer_id: customerId, article: str(input, 'article', { required: true, label: 'Artikel', max: 200 }), unit_cost: cost, unit_price: price, vat_rate: vat })}`;
  } catch (e) { if (String((e as Error).message).includes('consignment_items_company_id_customer_id_article_key')) throw new ConflictError('Artikeln finns redan hos återförsäljaren'); throw e; }
}

/** Utleverans, retur eller såld enligt återförsäljarens rapport (sålt skapar ett fakturautkast till återförsäljaren) */
export async function move(actor: Actor, itemId: number, input: Record<string, unknown>) {
  const kind = str(input, 'kind') as 'ship' | 'return' | 'sold';
  if (!['ship', 'return', 'sold'].includes(kind)) throw new ValidationError('Välj händelse');
  const qty = int(input, 'qty', 'Antal');
  if (qty <= 0 || qty > 1000000) throw new ValidationError('Ange antal');
  const d = date(input, 'date', 'Datum');
  return sql.begin(async (tx) => {
    const [i] = await tx<{ customer_id: number; article: string; unit_cost: number; unit_price: number; vat_rate: number }[]>`SELECT customer_id, article, unit_cost::float8 AS unit_cost, unit_price::float8 AS unit_price, vat_rate
      FROM consignment_items WHERE id = ${itemId} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!i) throw new NotFoundError('Artikeln');
    const moves = await tx<{ kind: 'ship' | 'return' | 'sold'; qty: number }[]>`SELECT kind, qty FROM consignment_moves WHERE item_id = ${itemId}`;
    const hand = onHand(moves);
    if (kind !== 'ship' && qty > hand) throw new ValidationError(`Återförsäljaren har ${hand} st i konsignation`);
    await ensure(tx, actor.companyId);
    const cost = qty * i.unit_cost;
    const lines = kind === 'ship' ? shipLines(cost) : kind === 'return' ? returnLines(cost) : soldLines(cost);
    const v = cost ? await createVoucher(tx, { actor, date: d, description: `Konsignation ${kind === 'ship' ? 'utleverans' : kind === 'return' ? 'retur' : 'såld'}: ${qty} st ${i.article}`, lines: fromSigned(lines), sourceType: 'consignment' }) : null;
    const inv = kind === 'sold' ? await saveDraftTx(tx, actor, null, { customer_id: i.customer_id, invoice_date: d,
      lines: [{ description: `${i.article} (sålt ur konsignationslager)`, quantity: qty, unit: 'st', unit_price: i.unit_price, vat_rate: i.vat_rate }] }) : null;
    await tx`INSERT INTO consignment_moves ${tx({ item_id: itemId, kind, qty, date: d, voucher_id: v?.id ?? null, invoice_id: inv?.id ?? null, created_by: actor.userId })}`;
    await auditBy(tx, actor, 'consignment', 'company', actor.companyId, { itemId, kind, qty });
    return { invoiceId: inv?.id ?? null, left: kind === 'ship' ? hand + qty : hand - qty };
  });
}
