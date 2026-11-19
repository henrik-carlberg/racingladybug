// Företagskort och resor – ren logik (testbar). Belopp i öre.

export interface CardTx { id: number; date: string; amount: number; text: string }
export interface ReceiptVoucher { id: number; date: string; amount: number; text: string }
const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
const words = (s: string) => new Set(s.toLowerCase().split(/[^a-zåäö0-9]+/).filter((w) => w.length >= 3));

/**
 * Kortköp ↔ bokförda kvitton: samma belopp, högst tre dagar isär. Varje kvitto används en gång.
 * Vid flera kandidater vinner närmast datum, därefter flest gemensamma ord (butikens namn).
 */
export function matchReceipts(txs: CardTx[], receipts: ReceiptVoucher[]): { txId: number; voucherId: number }[] {
  const used = new Set<number>(), out: { txId: number; voucherId: number }[] = [];
  for (const t of [...txs].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)) {
    const tw = words(t.text);
    const best = receipts.filter((r) => !used.has(r.id) && r.amount === -t.amount && days(r.date, t.date) <= 3)
      .map((r) => ({ r, d: days(r.date, t.date), w: [...words(r.text)].filter((x) => tw.has(x)).length }))
      .sort((a, b) => a.d - b.d || b.w - a.w || a.r.id - b.r.id)[0];
    if (best) { used.add(best.r.id); out.push({ txId: t.id, voucherId: best.r.id }); }
  }
  return out;
}

/**
 * Traktamente inom Sverige (Skatteverket): avresedagen är hel om resan börjar före kl. 12, hemresedagen hel om resan slutar efter kl. 19,
 * annars halva dagar. Dagarna däremellan är hela. Kräver övernattning; nätter = antal datumbyten.
 */
export function allowanceDays(depart: string, ret: string) {
  const d = new Date(depart), r = new Date(ret);
  if (!(r > d)) throw new Error('Hemkomsten ska vara efter avresan');
  const dDate = depart.slice(0, 10), rDate = ret.slice(0, 10);
  const nights = Math.round((Date.parse(rDate) - Date.parse(dDate)) / 864e5);
  if (nights < 1) return { full: 0, half: 0, nights: 0 };
  const hour = (s: string) => Number(s.slice(11, 13)) + Number(s.slice(14, 16)) / 60;
  const first = hour(depart) < 12 ? 'full' : 'half', last = hour(ret) > 19 ? 'full' : 'half';
  const full = (first === 'full' ? 1 : 0) + (last === 'full' ? 1 : 0) + Math.max(0, nights - 1);
  const half = (first === 'half' ? 1 : 0) + (last === 'half' ? 1 : 0);
  return { full, half, nights };
}
