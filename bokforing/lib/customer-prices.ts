// Kundprisavtal. Priser i öre per enhet exkl. moms.
export interface Agreement { id: number; scope: 'customer' | 'group'; net_price: number | null; discount_pct: number | null; min_qty: number; valid_from: string; valid_to: string | null }

export const applies = (a: Agreement, qty: number, date: string) => a.valid_from <= date && (!a.valid_to || a.valid_to >= date) && qty >= a.min_qty;
const disc = (list: number, pct: number) => Math.round(list * (1 - pct / 100));

/**
 * Kundens pris: det lägsta av listpris med grupprabatt och alla avtal som gäller för dagen och antalet
 * (kundens eller gruppens nettopris, eller rabatt i procent – volymrabatt är ett avtal med minsta antal).
 */
export function priceFor(o: { list: number; groupDiscount: number; agreements: Agreement[]; qty: number; date: string }) {
  let best = { price: disc(o.list, o.groupDiscount), source: o.groupDiscount ? `Grupprabatt ${o.groupDiscount} %` : 'Listpris', agreementId: null as number | null };
  for (const a of o.agreements) {
    if (!applies(a, o.qty, o.date)) continue;
    const p = a.net_price != null ? a.net_price : disc(o.list, a.discount_pct!);
    const label = `${a.scope === 'customer' ? 'Kundavtal' : 'Gruppavtal'}: ${a.net_price != null ? 'nettopris' : `−${a.discount_pct} %`}${a.min_qty ? ` från ${a.min_qty} st` : ''}`;
    if (p < best.price) best = { price: p, source: label, agreementId: a.id };
  }
  return best;
}

/** Marginal: försäljning mot anskaffningsvärde */
export function margin(revenue: number, cost: number) {
  return { revenue, cost, margin: revenue - cost, pct: revenue ? Math.round((revenue - cost) / revenue * 1000) / 10 : 0 };
}

export const expiresSoon = (validTo: string | null, today: string, days = 30) => !!validTo && validTo >= today && validTo <= new Date(Date.parse(today) + days * 864e5).toISOString().slice(0, 10);
