// Kortterminaler (Zettle, SumUp) och betalleverantörer (Stripe, Klarna, Shopify Payments) – ren logik (testbar).
// Leverantörernas svar normaliseras till dagsförsäljning och utbetalningar; belopp i öre.
import { ACC } from './bas';
import { fromSigned, type Line } from './ledger-lines';
import { splitGross, type Rate } from './shop';

export type Provider = 'zettle' | 'sumup' | 'stripe' | 'klarna' | 'shopify';
export const PROVIDER_LABEL: Record<Provider, string> = { zettle: 'Zettle', sumup: 'SumUp', stripe: 'Stripe', klarna: 'Klarna', shopify: 'Shopify Payments' };
/** Kortterminaler rapporterar dagsförsäljning; övriga bara utbetalningar (försäljningen bokförs från fakturor eller e-handeln) */
export const HAS_SALES: Record<Provider, boolean> = { zettle: true, sumup: true, stripe: false, klarna: false, shopify: false };

export interface DailySales { date: string; gross: Partial<Record<Rate, number>>; count: number }
export interface Payout { id: string; date: string; gross: number; refunds: number; fees: number; net: number; currency: string }

const RATE_SET = [25, 12, 6, 0];
const rate = (v: number, fallback: Rate): Rate => { const r = Math.round(v); return (RATE_SET.includes(r) ? r : fallback) as Rate; };
const dec = (v: unknown) => Math.round(Number(v ?? 0) * 100);
const day = (s: unknown) => String(s ?? '').slice(0, 10);

/** Zettle Purchase API v2: produkterna har momssats, beloppen anges i ören. Returer drar av. */
export function zettleSales(date: string, j: { purchases?: { amount: number; refund?: boolean; products?: { unitPrice: number; quantity: string | number; vatPercentage?: number; discountValue?: number }[] }[] }, fallback: Rate): DailySales {
  const gross: Partial<Record<Rate, number>> = {};
  let count = 0;
  for (const p of j.purchases ?? []) {
    count++;
    const sign = p.refund ? -1 : 1;
    const products = p.products ?? [];
    let sum = 0;
    for (const x of products) {
      const amt = Math.round(Number(x.unitPrice) * Number(x.quantity)) - Math.round(Number(x.discountValue ?? 0));
      const r = rate(Number(x.vatPercentage ?? fallback), fallback);
      gross[r] = (gross[r] ?? 0) + sign * amt; sum += amt;
    }
    // Rabatt på hela köpet eller köp utan produktrader: skillnaden läggs på standardsatsen
    const rest = Math.abs(Number(p.amount)) - sum;
    if (rest) gross[fallback] = (gross[fallback] ?? 0) + sign * rest;
  }
  return { date, gross, count };
}

/** Zettle Finance API: transaktioner på likvidkontot. PAYOUT är utbetalningen (negativ), PAYMENT_FEE avgifterna. En utbetalning per dag. */
export function zettlePayouts(j: { data?: { timestamp: string; amount: number; originatorTransactionType: string }[] } | { timestamp: string; amount: number; originatorTransactionType: string }[]): Payout[] {
  const rows = Array.isArray(j) ? j : j.data ?? [];
  const byDay = new Map<string, { fees: number; net: number }>();
  for (const t of rows) {
    const d = day(t.timestamp), cur = byDay.get(d) ?? { fees: 0, net: 0 };
    if (t.originatorTransactionType === 'PAYOUT') cur.net += -Number(t.amount);
    else if (t.originatorTransactionType === 'PAYMENT_FEE') cur.fees += -Number(t.amount);
    byDay.set(d, cur);
  }
  return [...byDay].filter(([, v]) => v.net > 0).map(([d, v]) => ({ id: `zettle-${d}`, date: d, gross: v.net + v.fees, refunds: 0, fees: v.fees, net: v.net, currency: 'SEK' }));
}

/** SumUp: transaktionshistoriken saknar momssats per rad – företagets standardsats används */
export function sumupSales(date: string, j: { items?: { amount: number; type?: string; status?: string; currency?: string }[] }, fallback: Rate): DailySales {
  let sum = 0, count = 0;
  for (const t of j.items ?? []) {
    if (t.status && t.status !== 'SUCCESSFUL') continue;
    count++;
    sum += (t.type === 'REFUND' ? -1 : 1) * dec(t.amount);
  }
  return { date, gross: sum ? { [fallback]: sum } : {}, count };
}
export function sumupPayouts(j: { id?: number | string; date: string; amount: number; fee?: number; type?: string; status?: string; currency?: string }[]): Payout[] {
  const byDay = new Map<string, Payout>();
  for (const p of j) {
    if (p.type && p.type !== 'PAYOUT') continue;
    const d = day(p.date), cur = byDay.get(d) ?? { id: `sumup-${d}`, date: d, gross: 0, refunds: 0, fees: 0, net: 0, currency: p.currency ?? 'SEK' };
    cur.net += dec(p.amount); cur.fees += dec(p.fee ?? 0); cur.gross = cur.net + cur.fees;
    byDay.set(d, cur);
  }
  return [...byDay.values()];
}

/** Stripe: utbetalningen och dess saldotransaktioner (belopp i ören). Avgifter ingår per transaktion. */
export function stripePayout(p: { id: string; amount: number; arrival_date: number; currency: string }, txs: { type: string; amount: number; fee: number }[]): Payout {
  let gross = 0, refunds = 0, fees = 0;
  for (const t of txs) {
    if (t.type === 'payout') continue;
    fees += t.fee;
    if (t.type === 'refund' || t.type === 'payment_refund') refunds += -t.amount;
    else gross += t.amount;
  }
  return { id: p.id, date: new Date(p.arrival_date * 1000).toISOString().slice(0, 10), gross, refunds, fees, net: p.amount, currency: p.currency.toUpperCase() };
}

/** Klarna Settlements API: summor per utbetalning i ören */
export function klarnaPayouts(j: { payouts?: { payout_date: string; payment_reference: string; currency_code: string; totals: { sale_amount: number; fee_amount: number; return_amount?: number; settlement_amount: number; holdback_amount?: number; release_amount?: number; correction_amount?: number } }[] }): Payout[] {
  return (j.payouts ?? []).map((p) => {
    const t = p.totals, other = (t.release_amount ?? 0) - (t.holdback_amount ?? 0) + (t.correction_amount ?? 0);
    return { id: p.payment_reference, date: day(p.payout_date), gross: t.sale_amount + other, refunds: t.return_amount ?? 0, fees: t.fee_amount, net: t.settlement_amount, currency: p.currency_code };
  });
}

/** Shopify Payments: utbetalningar med sammanställning (decimalbelopp) */
export function shopifyPayouts(j: { payouts?: { id: number | string; date: string; currency: string; amount: string; status?: string; summary?: Record<string, string> }[] }): Payout[] {
  return (j.payouts ?? []).filter((p) => !p.status || p.status === 'paid').map((p) => {
    const s = p.summary ?? {};
    const fees = ['charges_fee_amount', 'refunds_fee_amount', 'adjustments_fee_amount', 'reserved_funds_fee_amount', 'retried_payouts_fee_amount'].reduce((a, k) => a + dec(s[k]), 0);
    const refunds = -dec(s.refunds_gross_amount);
    const gross = dec(s.charges_gross_amount) + dec(s.adjustments_gross_amount) + dec(s.reserved_funds_gross_amount) + dec(s.retried_payouts_gross_amount);
    return { id: String(p.id), date: day(p.date), gross, refunds, fees, net: dec(p.amount), currency: p.currency };
  });
}

/** Dagsförsäljning från kortterminalen: avräkningskontot i debet, försäljning och moms per sats i kredit */
export function salesLines(s: DailySales, clearing: number): Line[] {
  const parts = splitGross(s.gross);
  const total = parts.reduce((a, x) => a + x.gross, 0);
  return fromSigned([
    { account: clearing, amount: total },
    ...parts.flatMap((x) => [{ account: ACC.sales[x.rate], amount: -x.net }, ...(x.vat ? [{ account: ACC.vatOut[x.rate], amount: -x.vat }] : [])]),
  ]);
}

/** Utbetalning: banken och avgiften i debet, avräkningskontot i kredit. Brutto − returer − avgifter ska bli nettot. */
export function payoutLines(p: Payout, o: { clearing: number; bank: number; fee: number }): Line[] {
  const diff = p.gross - p.refunds - p.fees - p.net;
  if (diff !== 0) throw new Error(`Utbetalningen går inte ihop: brutto ${p.gross / 100} − returer ${p.refunds / 100} − avgifter ${p.fees / 100} ≠ ${p.net / 100}`);
  return fromSigned([
    { account: o.bank, amount: p.net, description: 'Utbetalning' },
    ...(p.fees ? [{ account: o.fee, amount: p.fees, description: 'Avgifter' }] : []),
    { account: o.clearing, amount: -(p.net + p.fees) },
  ]);
}
