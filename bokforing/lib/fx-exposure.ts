// Valutaexponering. Valutabelopp i hundradelar (cent), kronor i öre.
export type Item = { kind: 'bank' | 'receivable' | 'payable'; currency: string; amountCurrency: number; bookedSek: number };
export type Forward = { currency: string; direction: 'sell' | 'buy'; amount: number };

/** Exponering per valuta: tillgångar (bank och kundfordringar) minus skulder; sålda terminer säkrar tillgångar och köpta säkrar skulder */
export function exposure(items: Item[], forwards: Forward[], rates: Record<string, number | null>) {
  const cur = [...new Set([...items.map((i) => i.currency), ...forwards.map((f) => f.currency)])].sort();
  return cur.map((c) => {
    const own = items.filter((i) => i.currency === c);
    const bank = own.filter((i) => i.kind === 'bank').reduce((s, i) => s + i.amountCurrency, 0);
    const receivables = own.filter((i) => i.kind === 'receivable').reduce((s, i) => s + i.amountCurrency, 0);
    const payables = own.filter((i) => i.kind === 'payable').reduce((s, i) => s + i.amountCurrency, 0);
    const net = bank + receivables - payables;
    const sold = forwards.filter((f) => f.currency === c && f.direction === 'sell').reduce((s, f) => s + Math.round(f.amount * 100), 0);
    const bought = forwards.filter((f) => f.currency === c && f.direction === 'buy').reduce((s, f) => s + Math.round(f.amount * 100), 0);
    const hedge = sold - bought, unhedged = net - hedge;
    const booked = own.reduce((s, i) => s + i.amountCurrency, 0) ? own.reduce((s, i) => s + i.bookedSek, 0) / own.reduce((s, i) => s + i.amountCurrency, 0) : null;
    const rate = rates[c] ?? booked;
    const sek = (cents: number) => (rate ? Math.round(cents * rate) : null);
    const hedgedShare = net !== 0 ? Math.round(Math.min(1, Math.abs(hedge) / Math.abs(net)) * 100) : null;
    return { currency: c, bank, receivables, payables, net, hedge, unhedged, rate, hedgedShare, netSek: sek(net), unhedgedSek: sek(unhedged),
      // Effekt på resultatet om valutan stärks eller försvagas mot kronan
      sensitivity: [-10, -5, 5, 10].map((p) => ({ pct: p, effect: rate ? Math.round(unhedged * rate * p / 100) : null })) };
  });
}
export const overLimit = (unhedgedSek: number | null, limit: number | null) => unhedgedSek != null && limit != null && Math.abs(unhedgedSek) > limit;
