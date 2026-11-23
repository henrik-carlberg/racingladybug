// Evenemang. Belopp i öre.
import { defaultSalesAccount } from '@/lib/invoice';
export const DEFERRED = 2970; // Förutbetalda intäkter
export const VAT_OUT: Record<number, number> = { 25: 2611, 12: 2621, 6: 2631 };
export const split = (gross: number, vat: number) => { const net = Math.round(gross / (1 + vat / 100)); return { net, vat: gross - net }; };

/** Biljettförsäljning: moms när betalningen tas emot, nettot är förutbetald intäkt till eventdagen */
export function saleLines(gross: number, vatRate: number, bank = 1930) {
  const s = split(gross, vatRate);
  return [{ account: bank, amount: gross }, { account: DEFERRED, amount: -s.net }, ...(s.vat ? [{ account: VAT_OUT[vatRate], amount: -s.vat }] : [])];
}
export function refundLines(gross: number, vatRate: number, bank = 1930) {
  const s = split(gross, vatRate);
  return [{ account: DEFERRED, amount: s.net }, ...(s.vat ? [{ account: VAT_OUT[vatRate], amount: s.vat }] : []), { account: bank, amount: -gross }];
}

/** Eventet är genomfört: den förutbetalda intäkten (biljetter per momssats och sponsring) blir intäkt */
export function recognitionLines(tickets: { net: number; vat_rate: number }[], sponsorNet: number) {
  const by = new Map<number, number>();
  for (const t of tickets) { const acc = defaultSalesAccount(t.vat_rate, false); by.set(acc, (by.get(acc) ?? 0) + t.net); }
  if (sponsorNet) by.set(defaultSalesAccount(25, false), (by.get(defaultSalesAccount(25, false)) ?? 0) + sponsorNet);
  const total = [...by.values()].reduce((s, v) => s + v, 0);
  return total ? [{ account: DEFERRED, amount: total }, ...[...by].map(([account, amount]) => ({ account, amount: -amount }))] : [];
}

export const seatsLeft = (capacity: number | null, sold: number) => (capacity == null ? null : capacity - sold);
export function eventResult(o: { tickets: number; sponsors: number; costs: number; budget: number }) {
  const revenue = o.tickets + o.sponsors;
  return { revenue, costs: o.costs, result: revenue - o.costs, vsBudget: o.budget ? o.costs - o.budget : 0 };
}
