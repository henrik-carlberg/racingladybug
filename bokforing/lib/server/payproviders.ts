import 'server-only';
// Hämtning från kortterminaler och betalleverantörer. Adresser och fält är samlade här så att de kan anpassas efter leverantörernas API.
// PAYPROVIDER_TEST_URL (endast test) pekar alla anrop till en lokal fejkserver: {url}/{leverantör}/...
import { klarnaPayouts, shopifyPayouts, stripePayout, sumupPayouts, sumupSales, zettlePayouts, zettleSales, type DailySales, type Payout, type Provider } from '@/lib/payproviders';
import type { Rate } from '@/lib/shop';

export interface Credentials { api_key: string; secret?: string; merchant_code?: string; shop?: string }
const test = () => process.env.PAYPROVIDER_TEST_URL?.replace(/\/$/, '');
export const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/;

const HOSTS: Record<string, string> = {
  'zettle-oauth': 'https://oauth.zettle.com', 'zettle-purchase': 'https://purchase.izettle.com', 'zettle-finance': 'https://finance.izettle.com',
  sumup: 'https://api.sumup.com', stripe: 'https://api.stripe.com', klarna: 'https://api.klarna.com',
};
function url(p: Provider, host: string, path: string, c: Credentials) {
  const t = test();
  if (t) return `${t}/${p}${path}`;
  if (p === 'shopify') { if (!c.shop || !SHOP_DOMAIN.test(c.shop)) throw new Error('Ogiltig butiksadress – ange namn.myshopify.com'); return `https://${c.shop}${path}`; }
  return HOSTS[host] + path;
}
async function get<T>(u: string, headers: Record<string, string>): Promise<T> {
  const r = await fetch(u, { headers: { accept: 'application/json', ...headers }, redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (r.status === 401 || r.status === 403) throw new Error('Leverantören godtog inte nyckeln – kontrollera behörigheten');
  if (!r.ok) throw new Error(`Leverantören svarade ${r.status}`);
  return r.json() as Promise<T>;
}

async function zettleToken(c: Credentials) {
  const r = await fetch(url('zettle', 'zettle-oauth', '/token', c), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', client_id: c.secret ?? '', assertion: c.api_key }) });
  if (!r.ok) throw new Error('Zettle godtog inte API-nyckeln');
  return ((await r.json()) as { access_token: string }).access_token;
}
const nextDay = (d: string) => new Date(Date.parse(d) + 864e5).toISOString().slice(0, 10);

/** Försäljning en dag (endast kortterminaler) */
export async function fetchSales(p: Provider, c: Credentials, date: string, fallback: Rate): Promise<DailySales> {
  if (p === 'zettle') {
    const tok = await zettleToken(c);
    return zettleSales(date, await get(url(p, 'zettle-purchase', `/purchases/v2?startDate=${date}T00:00:00&endDate=${nextDay(date)}T00:00:00&limit=1000`, c), { authorization: `Bearer ${tok}` }), fallback);
  }
  if (p === 'sumup') return sumupSales(date, await get(url(p, 'sumup', `/v0.1/me/transactions/history?oldest_time=${date}T00:00:00Z&newest_time=${nextDay(date)}T00:00:00Z&limit=1000`, c), { authorization: `Bearer ${c.api_key}` }), fallback);
  return { date, gross: {}, count: 0 };
}

/** Utbetalningar från och med ett datum */
export async function fetchPayouts(p: Provider, c: Credentials, from: string, to: string): Promise<Payout[]> {
  if (p === 'zettle') {
    const tok = await zettleToken(c);
    return zettlePayouts(await get(url(p, 'zettle-finance', `/v2/accounts/liquid/transactions?start=${from}T00:00:00&end=${nextDay(to)}T00:00:00&includeTransactionType=PAYOUT&includeTransactionType=PAYMENT_FEE`, c), { authorization: `Bearer ${tok}` }));
  }
  if (p === 'sumup') {
    if (!c.merchant_code || !/^[A-Z0-9]{4,20}$/.test(c.merchant_code)) throw new Error('Ange SumUp-handlarkoden');
    return sumupPayouts(await get(url(p, 'sumup', `/v1.0/merchants/${c.merchant_code}/payouts?start_date=${from}&end_date=${to}`, c), { authorization: `Bearer ${c.api_key}` }));
  }
  if (p === 'stripe') {
    const h = { authorization: `Bearer ${c.api_key}` };
    const gte = Math.floor(Date.parse(from) / 1000), lte = Math.floor(Date.parse(nextDay(to)) / 1000) - 1;
    const list = await get<{ data: { id: string; amount: number; arrival_date: number; currency: string; status: string }[] }>(url(p, 'stripe', `/v1/payouts?limit=100&status=paid&arrival_date[gte]=${gte}&arrival_date[lte]=${lte}`, c), h);
    const out: Payout[] = [];
    for (const po of list.data) {
      const txs = await get<{ data: { type: string; amount: number; fee: number }[] }>(url(p, 'stripe', `/v1/balance_transactions?limit=100&payout=${encodeURIComponent(po.id)}`, c), h);
      out.push(stripePayout(po, txs.data));
    }
    return out;
  }
  if (p === 'klarna') {
    const auth = `Basic ${Buffer.from(`${c.api_key}:${c.secret ?? ''}`).toString('base64')}`;
    return klarnaPayouts(await get(url(p, 'klarna', `/settlements/v1/payouts?start_date=${from}T00:00:00Z&end_date=${nextDay(to)}T00:00:00Z&size=500`, c), { authorization: auth }));
  }
  return shopifyPayouts(await get(url(p, 'shopify', `/admin/api/2024-10/shopify_payments/payouts.json?date_min=${from}&date_max=${to}&status=paid`, c), { 'x-shopify-access-token': c.api_key }));
}
