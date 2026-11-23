import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { expiresSoon, margin, priceFor, type Agreement } from '@/lib/customer-prices';
import type { Actor } from './actor';
import { date, int, optInt, str } from './input';

type Db = Tx | typeof sql;
const pct = (v: unknown, label: string) => { const n = Number(String(v ?? '').trim().replace(',', '.')); if (!Number.isFinite(n) || n < 0 || n >= 100) throw new ValidationError(`Ange ${label} i procent`); return Math.round(n * 100) / 100; };

/** Priset för en kund, artikel, antal och dag – används av kundorder när inget pris anges */
export async function customerPrice(db: Db, companyId: number, customerId: number, productId: number, qty: number, at = today()) {
  const [p] = await db<{ list: number; group_id: number | null; group_discount: number }[]>`SELECT pr.sales_price::float8 AS list, c.customer_group_id AS group_id, COALESCE(g.discount_pct, 0)::float8 AS group_discount
    FROM inv_products pr JOIN customers c ON c.id = ${customerId} AND c.company_id = ${companyId} LEFT JOIN customer_groups g ON g.id = c.customer_group_id
    WHERE pr.id = ${productId} AND pr.company_id = ${companyId}`;
  if (!p) return null;
  const agreements = await db<Agreement[]>`SELECT id, CASE WHEN customer_id IS NULL THEN 'group' ELSE 'customer' END AS scope, net_price::float8 AS net_price, discount_pct::float8 AS discount_pct,
      min_qty::float8 AS min_qty, to_char(valid_from,'YYYY-MM-DD') AS valid_from, to_char(valid_to,'YYYY-MM-DD') AS valid_to
    FROM price_agreements WHERE company_id = ${companyId} AND product_id = ${productId} AND (customer_id = ${customerId} OR (${p.group_id}::int IS NOT NULL AND group_id = ${p.group_id}))`;
  return priceFor({ list: p.list, groupDiscount: p.group_discount, agreements, qty, date: at });
}

export async function overview(companyId: number) {
  const t = today();
  const groups = await sql<{ id: number; name: string; discount_pct: number; customers: number }[]>`SELECT g.id, g.name, g.discount_pct::float8 AS discount_pct,
      (SELECT count(*)::int FROM customers c WHERE c.customer_group_id = g.id) AS customers FROM customer_groups g WHERE g.company_id = ${companyId} ORDER BY g.name`;
  const agreements = await sql<{ id: number; party: string; scope: string; product: string; list: number; net_price: number | null; discount_pct: number | null; min_qty: number; valid_from: string; valid_to: string | null }[]>`
    SELECT a.id, COALESCE(c.name, g.name) AS party, CASE WHEN a.customer_id IS NULL THEN 'group' ELSE 'customer' END AS scope, p.sku || ' ' || p.name AS product, p.sales_price::float8 AS list,
      a.net_price::float8 AS net_price, a.discount_pct::float8 AS discount_pct, a.min_qty::float8 AS min_qty, to_char(a.valid_from,'YYYY-MM-DD') AS valid_from, to_char(a.valid_to,'YYYY-MM-DD') AS valid_to
    FROM price_agreements a JOIN inv_products p ON p.id = a.product_id LEFT JOIN customers c ON c.id = a.customer_id LEFT JOIN customer_groups g ON g.id = a.group_id
    WHERE a.company_id = ${companyId} ORDER BY (a.valid_to IS NOT NULL AND a.valid_to < ${t}), party, product, a.min_qty`;
  const customers = await sql<{ id: number; name: string; group_id: number | null }[]>`SELECT id, name, customer_group_id AS group_id FROM customers WHERE company_id = ${companyId} ORDER BY name LIMIT 500`;
  const products = await sql<{ id: number; label: string }[]>`SELECT id, sku || ' ' || name AS label FROM inv_products WHERE company_id = ${companyId} AND active ORDER BY sku`;
  // Marginal per kund på kundorder de senaste tolv månaderna (anskaffningsvärde = artikelns snittpris)
  const sales = await sql<{ customer: string; revenue: number; cost: number }[]>`SELECT c.name AS customer, SUM(l.qty * l.unit_price)::float8 AS revenue, SUM(l.qty * p.avg_cost)::float8 AS cost
    FROM inv_sales_order_lines l JOIN inv_sales_orders o ON o.id = l.order_id JOIN customers c ON c.id = o.customer_id JOIN inv_products p ON p.id = l.product_id
    WHERE o.company_id = ${companyId} AND o.status <> 'cancelled' AND o.order_date > ${t}::date - 365 GROUP BY c.name ORDER BY 2 DESC`;
  return {
    groups, customers, products,
    agreements: agreements.map((a) => ({ ...a, active: a.valid_from <= t && (!a.valid_to || a.valid_to >= t), expiring: expiresSoon(a.valid_to, t) })),
    margins: sales.map((s) => ({ customer: s.customer, ...margin(Math.round(s.revenue), Math.round(s.cost)) })),
  };
}

export async function addGroup(actor: Actor, input: Record<string, unknown>) {
  try {
    await sql`INSERT INTO customer_groups ${sql({ company_id: actor.companyId, name: str(input, 'name', { required: true, label: 'Kundgrupp', max: 100 }), discount_pct: pct(input.discount_pct || '0', 'grupprabatten') })}`;
  } catch (e) { if (String((e as Error).message).includes('customer_groups_company_id_name_key')) throw new ConflictError('Kundgruppen finns redan'); throw e; }
}

export async function setGroup(actor: Actor, input: Record<string, unknown>) {
  const customerId = int(input, 'customer_id', 'Kund'), groupId = optInt(input, 'group_id', 'Kundgrupp');
  if (groupId) { const [g] = await sql`SELECT 1 FROM customer_groups WHERE id = ${groupId} AND company_id = ${actor.companyId}`; if (!g) throw new NotFoundError('Kundgruppen'); }
  const r = await sql`UPDATE customers SET customer_group_id = ${groupId} WHERE id = ${customerId} AND company_id = ${actor.companyId}`;
  if (!r.count) throw new NotFoundError('Kunden');
}

/** Prisavtal för en kund eller kundgrupp: nettopris eller rabatt, eventuellt från ett minsta antal (volymrabatt) */
export async function addAgreement(actor: Actor, input: Record<string, unknown>) {
  const [scope, rawId] = String(input.party ?? '').split(':');
  const partyId = Number(rawId);
  if (!['c', 'g'].includes(scope) || !Number.isInteger(partyId)) throw new ValidationError('Välj kund eller kundgrupp');
  const [ok] = scope === 'c' ? await sql`SELECT 1 FROM customers WHERE id = ${partyId} AND company_id = ${actor.companyId}` : await sql`SELECT 1 FROM customer_groups WHERE id = ${partyId} AND company_id = ${actor.companyId}`;
  if (!ok) throw new NotFoundError(scope === 'c' ? 'Kunden' : 'Kundgruppen');
  const productId = int(input, 'product_id', 'Artikel');
  const [p] = await sql`SELECT 1 FROM inv_products WHERE id = ${productId} AND company_id = ${actor.companyId}`;
  if (!p) throw new NotFoundError('Artikeln');
  const netRaw = String(input.net_price ?? '').trim(), discRaw = String(input.discount_pct ?? '').trim();
  if (!!netRaw === !!discRaw) throw new ValidationError('Ange antingen ett nettopris eller en rabatt i procent');
  const net = netRaw ? parseAmount(netRaw) : null;
  if (netRaw && (net == null || net < 0)) throw new ValidationError('Ange nettopriset i kronor');
  const discount = discRaw ? pct(discRaw, 'rabatten') : null;
  if (discRaw && !discount) throw new ValidationError('Rabatten ska vara större än noll');
  const minQty = Number(String(input.min_qty ?? '').replace(',', '.') || '0');
  if (!Number.isFinite(minQty) || minQty < 0) throw new ValidationError('Ogiltigt minsta antal');
  const from = date(input, 'valid_from', 'Gäller från', false) || today(), to = date(input, 'valid_to', 'Gäller till', false) || null;
  if (to && to < from) throw new ValidationError('Slutdatumet ska vara efter startdatumet');
  const [a] = await sql<{ id: number }[]>`INSERT INTO price_agreements ${sql({ company_id: actor.companyId, customer_id: scope === 'c' ? partyId : null, group_id: scope === 'g' ? partyId : null, product_id: productId,
    net_price: net, discount_pct: discount, min_qty: minQty, valid_from: from, valid_to: to, created_by: actor.userId })} RETURNING id`;
  await auditBy(sql, actor, 'price_agreement', 'price_agreement', a.id, { scope, partyId, productId });
}

export async function endAgreement(actor: Actor, id: number) {
  const r = await sql`UPDATE price_agreements SET valid_to = GREATEST(valid_from, ${today()}::date) WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!r.count) throw new NotFoundError('Avtalet');
}
