// Kassa och e-handel – ren logik (testbar): Z-rapport, webhook-signaturer och order från Shopify/WooCommerce
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ACC } from './bas';
import { fromSigned, type Line } from './ledger-lines';
import { decimalToOre } from './bank/parse';

export type Rate = 25 | 12 | 6 | 0;
export const RATES: Rate[] = [25, 12, 6, 0];

/** Försäljning per momssats (inklusive moms) → nettobelopp och moms per sats */
export function splitGross(gross: Partial<Record<Rate, number>>) {
  return RATES.filter((r) => (gross[r] ?? 0) !== 0).map((r) => {
    const g = gross[r] ?? 0;
    const net = Math.round((g * 100) / (100 + r));
    return { rate: r, gross: g, net, vat: g - net };
  });
}

export const PAYMENT_ACCOUNTS = { cash: 1910, card: 1580, swish: 1930, invoice: 1510, giftcard: 2420 } as const;
export type PaymentMethod = keyof typeof PAYMENT_ACCOUNTS;
export const PAYMENT_LABEL: Record<PaymentMethod, string> = { cash: 'Kontant', card: 'Kort', swish: 'Swish', invoice: 'Faktura', giftcard: 'Presentkort (inlöst)' };

/** Kontering av dagskassan: betalsätt i debet, försäljning och utgående moms i kredit. Diff (kassadifferens) mot 3740. */
export function cashReportLines(gross: Partial<Record<Rate, number>>, payments: Partial<Record<PaymentMethod, number>>, opts: { allowDiff?: boolean; maxDiff?: number } = {}): Line[] {
  const sales = splitGross(gross);
  const totalSales = sales.reduce((s, x) => s + x.gross, 0);
  const totalPay = Object.values(payments).reduce((s, v) => s + (v ?? 0), 0);
  const diff = totalPay - totalSales;
  if (diff !== 0 && (!opts.allowDiff || Math.abs(diff) > (opts.maxDiff ?? 10000))) {
    throw new Error(`Betalningarna (${totalPay / 100}) stämmer inte med försäljningen (${totalSales / 100})`);
  }
  return fromSigned([
    ...Object.entries(payments).map(([m, v]) => ({ account: PAYMENT_ACCOUNTS[m as PaymentMethod], amount: v ?? 0 })),
    ...sales.flatMap((x) => [{ account: ACC.sales[x.rate], amount: -x.net }, ...(x.vat ? [{ account: ACC.vatOut[x.rate], amount: -x.vat }] : [])]),
    ...(diff ? [{ account: ACC.rounding, amount: -diff, description: 'Kassadifferens' }] : []),
  ]);
}

// ---------- Webhooks ----------

/** Shopify och WooCommerce signerar båda med HMAC-SHA256 av råa kroppen, base64 (X-Shopify-Hmac-Sha256 / X-WC-Webhook-Signature) */
export function verifyHmacBase64(secret: string, body: string, signature: string | null): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(body, 'utf8').digest();
  const got = Buffer.from(signature, 'base64');
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export interface ShopOrder {
  externalId: string; number: string; date: string; currency: string; paid: boolean;
  total: number; vatByRate: Partial<Record<Rate, number>>; vat: number;
}

const toDate = (s: unknown) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s) ? new Date(s).toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' }) : new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' }));
const ore = (v: unknown) => decimalToOre(String(v ?? '0'));
const rateOf = (r: number): Rate | null => ([25, 12, 6, 0] as number[]).includes(Math.round(r)) ? (Math.round(r) as Rate) : null;

/** Shopify-order (webhook orders/paid eller orders/create) */
export function parseShopifyOrder(o: Record<string, unknown>): ShopOrder {
  const vatByRate: Partial<Record<Rate, number>> = {};
  for (const t of (o.tax_lines as { rate: number; price: string }[] | undefined) ?? []) {
    const r = rateOf(Number(t.rate) * 100);
    if (r == null) throw new Error(`Momssatsen ${t.rate} stöds inte`);
    vatByRate[r] = (vatByRate[r] ?? 0) + ore(t.price);
  }
  return {
    externalId: String(o.id), number: String(o.name ?? o.order_number ?? o.id), date: toDate(o.processed_at ?? o.created_at),
    currency: String(o.currency ?? 'SEK'), paid: o.financial_status === 'paid' || o.financial_status === undefined,
    total: ore(o.total_price), vatByRate, vat: ore(o.total_tax),
  };
}

/** WooCommerce-order (webhook order.created / order.updated) */
export function parseWooOrder(o: Record<string, unknown>): ShopOrder {
  const vatByRate: Partial<Record<Rate, number>> = {};
  for (const t of (o.tax_lines as { rate_percent: number; tax_total: string; shipping_tax_total: string }[] | undefined) ?? []) {
    const r = rateOf(Number(t.rate_percent));
    if (r == null) throw new Error(`Momssatsen ${t.rate_percent} % stöds inte`);
    vatByRate[r] = (vatByRate[r] ?? 0) + ore(t.tax_total) + ore(t.shipping_tax_total);
  }
  return {
    externalId: String(o.id), number: String(o.number ?? o.id), date: toDate(o.date_paid ?? o.date_created),
    currency: String(o.currency ?? 'SEK'), paid: ['processing', 'completed'].includes(String(o.status)) && !!o.date_paid,
    total: ore(o.total), vatByRate, vat: ore(o.total_tax),
  };
}

/**
 * Kontering av en betald order: betalväxeln (1580) i debet, försäljning och moms per sats i kredit.
 * Underlaget per sats räknas från momsen; det som blir kvar (momsfritt eller avrundning) läggs på 0 %-försäljning eller största satsen.
 */
export function orderBookingLines(o: ShopOrder, clearing: number, costCenterId?: number | null): Line[] {
  if (o.total <= 0) throw new Error('Ordern saknar belopp');
  const rates = RATES.filter((r) => r > 0 && (o.vatByRate[r] ?? 0) > 0);
  const vatSum = rates.reduce<number>((s, r) => s + (o.vatByRate[r] ?? 0), 0);
  if (Math.abs(vatSum - o.vat) > 100) throw new Error('Momsen per sats stämmer inte med orderns moms');
  const bases = rates.map((r) => ({ rate: r, vat: o.vatByRate[r]!, base: Math.round((o.vatByRate[r]! * 100) / r) }));
  const net = o.total - vatSum;
  const rest = net - bases.reduce((s, b) => s + b.base, 0);
  if (bases.length && Math.abs(rest) <= 100 * bases.length) bases.sort((a, b) => b.base - a.base)[0].base += rest;
  const zero = bases.length && Math.abs(rest) <= 100 * bases.length ? 0 : rest;
  if (zero < 0) throw new Error('Orderns belopp och moms går inte ihop');
  return fromSigned([
    { account: clearing, amount: o.total },
    ...bases.flatMap((b) => [{ account: ACC.sales[b.rate], amount: -b.base, costCenterId }, { account: ACC.vatOut[b.rate], amount: -b.vat }]),
    ...(zero ? [{ account: ACC.sales[0], amount: -zero, costCenterId }] : []),
  ]);
}
