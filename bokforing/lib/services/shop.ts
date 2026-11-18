import 'server-only';
import { randomBytes } from 'node:crypto';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { decrypt, encrypt } from '@/lib/server/crypto';
import { cashReportLines, orderBookingLines, parseShopifyOrder, parseWooOrder, verifyHmacBase64, PAYMENT_ACCOUNTS, RATES, type PaymentMethod, type Rate } from '@/lib/shop';
import type { Actor } from './actor';
import { date, optInt, str } from './input';
import { dimId } from './dimensions';

const ACCOUNT_NAMES: Record<number, string> = { 1580: 'Fordringar för kontokort och kuponger', 1910: 'Kassa', 2420: 'Förskott från kunder' };
async function ensure(companyId: number, accounts: number[]) {
  for (const n of accounts) if (ACCOUNT_NAMES[n]) await sql`INSERT INTO accounts (company_id, number, name) VALUES (${companyId}, ${n}, ${ACCOUNT_NAMES[n]}) ON CONFLICT DO NOTHING`;
}

// ---------- Dagskassa ----------

export async function createCashReport(actor: Actor, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum');
  const gross: Partial<Record<Rate, number>> = {};
  for (const r of RATES) { const v = optInt(input, `sales_${r}`, `Försäljning ${r} %`); if (v) gross[r] = v; }
  const payments: Partial<Record<PaymentMethod, number>> = {};
  for (const m of Object.keys(PAYMENT_ACCOUNTS) as PaymentMethod[]) { const v = optInt(input, `pay_${m}`, m); if (v) payments[m] = v; }
  if (!Object.keys(gross).length) throw new ValidationError('Ange försäljningen per momssats');
  let lines;
  try { lines = cashReportLines(gross, payments, { allowDiff: input.allow_diff === true || input.allow_diff === 'on', maxDiff: 10000 }); }
  catch (e) { throw new ValidationError((e as Error).message + '. Kryssa i "Kassadifferens" om skillnaden är högst 100 kr.'); }
  const register = str(input, 'register') || 'Kassa 1';
  const z = str(input, 'z_number');
  const cc = dimId(input.cost_center_id);
  await ensure(actor.companyId, Object.keys(payments).map((m) => PAYMENT_ACCOUNTS[m as PaymentMethod]));
  try {
    return await sql.begin(async (tx) => {
      const v = await createVoucher(tx, {
        actor, date: d, description: `Dagskassa ${register}${z ? `, Z-rapport ${z}` : ''}`, sourceType: 'cash_report',
        lines: cc ? lines.map((l) => (l.account >= 3000 && l.account < 4000 && l.account !== 3740 ? { ...l, costCenterId: cc } : l)) : lines,
      });
      const [r] = await tx<{ id: number }[]>`INSERT INTO cash_reports (company_id, date, register, z_number, data, voucher_id, created_by)
        VALUES (${actor.companyId}, ${d}, ${register}, ${z}, ${tx.json({ gross, payments } as never)}, ${v.id}, ${actor.userId}) RETURNING id`;
      await auditBy(tx, actor, 'create', 'cash_report', r.id);
      return { id: r.id, voucherId: v.id };
    });
  } catch (e) {
    if (String((e as Error).message).includes('cash_reports_company_id_register_z_number_date_key')) throw new ConflictError('Z-rapporten är redan registrerad');
    throw e;
  }
}

export async function listCashReports(companyId: number) {
  return sql<{ id: number; date: string; register: string; z_number: string; data: { gross: Record<string, number>; payments: Record<string, number> }; voucher_id: number }[]>`
    SELECT id, to_char(date,'YYYY-MM-DD') AS date, register, z_number, data, voucher_id FROM cash_reports WHERE company_id = ${companyId} ORDER BY date DESC, id DESC LIMIT 60`;
}

// ---------- E-handel ----------

export interface ShopConnection { id: number; platform: 'shopify' | 'woocommerce'; name: string; path_token: string; clearing_account: number; active: boolean; orders: number; last_order: string | null }

export async function listConnections(companyId: number): Promise<ShopConnection[]> {
  return [...await sql<ShopConnection[]>`
    SELECT c.id, c.platform, c.name, c.path_token, c.clearing_account, c.active,
      (SELECT count(*)::int FROM shop_orders o WHERE o.connection_id = c.id) AS orders, (SELECT to_char(max(o.order_date),'YYYY-MM-DD') FROM shop_orders o WHERE o.connection_id = c.id) AS last_order
    FROM shop_connections c WHERE c.company_id = ${companyId} ORDER BY c.id`];
}

/** Skapar en koppling. Shopify: klistra in hemligheten som Shopify visar för webhooks. WooCommerce: en hemlighet skapas som du klistrar in i WooCommerce. */
export async function createConnection(actor: Actor, input: Record<string, unknown>) {
  const platform = str(input, 'platform');
  if (!['shopify', 'woocommerce'].includes(platform)) throw new ValidationError('Välj Shopify eller WooCommerce');
  let secret = str(input, 'secret');
  if (platform === 'shopify' && !secret) throw new ValidationError('Klistra in signeringshemligheten från Shopify (Inställningar → Aviseringar → Webhooks)');
  if (!secret) secret = randomBytes(24).toString('base64url');
  const clearing = optInt(input, 'clearing_account', 'Konto för betalningar') ?? 1580;
  await ensure(actor.companyId, [clearing]);
  const [r] = await sql<{ id: number }[]>`INSERT INTO shop_connections ${sql({
    company_id: actor.companyId, platform, name: str(input, 'name') || (platform === 'shopify' ? 'Shopify' : 'WooCommerce'), path_token: randomBytes(18).toString('base64url'),
    secret_enc: encrypt(secret), clearing_account: clearing, cost_center_id: dimId(input.cost_center_id), created_by: actor.userId,
  })} RETURNING id`;
  await auditBy(sql, actor, 'create', 'shop_connection', r.id, { platform });
  return { id: r.id, secret: platform === 'woocommerce' && !str(input, 'secret') ? secret : null };
}

export async function setConnectionActive(actor: Actor, id: number, active: boolean) {
  const r = await sql`UPDATE shop_connections SET active = ${active} WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!r.count) throw new NotFoundError('Kopplingen');
}

export async function listOrders(companyId: number) {
  return sql<{ id: number; shop: string; number: string; order_date: string; currency: string; total: number; vat: number; status: string; message: string; voucher_id: number | null }[]>`
    SELECT o.id, c.name AS shop, o.number, to_char(o.order_date,'YYYY-MM-DD') AS order_date, o.currency, o.total, o.vat, o.status, o.message, o.voucher_id
    FROM shop_orders o JOIN shop_connections c ON c.id = o.connection_id WHERE o.company_id = ${companyId} ORDER BY o.created_at DESC LIMIT 100`;
}

/** Tar emot en webhook från butiken. Returnerar HTTP-status och resultat. Betalda order i SEK bokförs en gång. */
export async function handleShopWebhook(token: string, headers: Headers, body: string): Promise<{ status: number; result: string }> {
  const [c] = await sql<{ id: number; company_id: number; platform: 'shopify' | 'woocommerce'; secret_enc: string; clearing_account: number; cost_center_id: number | null; active: boolean; owner: number | null }[]>`
    SELECT c.id, c.company_id, c.platform, c.secret_enc, c.clearing_account, c.cost_center_id, c.active,
      (SELECT m.user_id FROM memberships m WHERE m.company_id = c.company_id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1) AS owner
    FROM shop_connections c WHERE c.path_token = ${token}`;
  if (!c) return { status: 404, result: 'unknown' };
  // WooCommerce skickar ett ping utan signatur när webhooken skapas
  if (c.platform === 'woocommerce' && !headers.get('x-wc-webhook-signature') && /^webhook_id=\d+$/.test(body.trim())) return { status: 200, result: 'ping' };
  const sig = c.platform === 'shopify' ? headers.get('x-shopify-hmac-sha256') : headers.get('x-wc-webhook-signature');
  if (!verifyHmacBase64(decrypt(c.secret_enc), body, sig)) return { status: 401, result: 'bad_signature' };
  if (!c.active || !c.owner) return { status: 200, result: 'inactive' };
  const topic = c.platform === 'shopify' ? headers.get('x-shopify-topic') : headers.get('x-wc-webhook-topic');
  if (topic && !/^orders\/(paid|create)$|^order\.(created|updated)$/.test(topic)) return { status: 200, result: 'ignored' };
  let order;
  try { order = c.platform === 'shopify' ? parseShopifyOrder(JSON.parse(body)) : parseWooOrder(JSON.parse(body)); }
  catch (e) { return { status: 200, result: `invalid: ${(e as Error).message}` }; }
  if (!order.paid) return { status: 200, result: 'not_paid' };
  const actor: Actor = { companyId: c.company_id, userId: c.owner, apiKeyId: null, role: 'owner' };
  const existing = await sql`SELECT 1 FROM shop_orders WHERE connection_id = ${c.id} AND external_id = ${order.externalId}`;
  if (existing.length) return { status: 200, result: 'duplicate' };
  const record = (status: string, message: string, voucherId: number | null, db = sql) => db`
    INSERT INTO shop_orders (connection_id, company_id, external_id, number, order_date, currency, total, vat, status, message, voucher_id)
    VALUES (${c.id}, ${c.company_id}, ${order.externalId}, ${order.number}, ${order.date}, ${order.currency}, ${order.total}, ${order.vat}, ${status}, ${message}, ${voucherId}) ON CONFLICT DO NOTHING`;
  if (order.currency !== 'SEK') { await record('skipped', `Valutan ${order.currency} bokförs inte automatiskt`, null); return { status: 200, result: 'skipped' }; }
  try {
    const lines = orderBookingLines(order, c.clearing_account, c.cost_center_id);
    await sql.begin(async (tx) => {
      const v = await createVoucher(tx, { actor, date: order.date, description: `Order ${order.number} (${c.platform === 'shopify' ? 'Shopify' : 'WooCommerce'})`, lines, sourceType: 'shop_order' });
      await record('booked', '', v.id, tx as never);
    });
    return { status: 200, result: 'booked' };
  } catch (e) {
    await record('error', (e as Error).message.slice(0, 300), null);
    return { status: 200, result: 'error' };
  }
}
