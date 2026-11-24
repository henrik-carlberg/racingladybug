// Inköpsanalys. Belopp i öre exkl. moms.
export const CATEGORIES: [number, number, string][] = [
  [4000, 4999, 'Varor och material'], [5000, 5299, 'Lokaler'], [5300, 5499, 'Förbrukningsinventarier och material'], [5500, 5599, 'Reparation och underhåll'],
  [5600, 5699, 'Bilar och transport'], [5700, 5799, 'Frakter'], [5800, 5899, 'Resor'], [5900, 5999, 'Reklam och marknadsföring'], [6000, 6199, 'Kontor och förbrukning'],
  [6200, 6299, 'Tele och data'], [6300, 6399, 'Försäkringar'], [6400, 6499, 'Förvaltning'], [6500, 6599, 'Konsulter och tjänster'], [6900, 6999, 'Övriga kostnader'],
];
export const categoryOf = (account: number) => CATEGORIES.find(([a, b]) => account >= a && account <= b)?.[2] ?? 'Övrigt';
export const change = (now: number, before: number) => (before > 0 ? Math.round((now - before) / before * 1000) / 10 : null);
/** Paretolistan: leverantörerna som tillsammans står för 80 % av inköpen */
export function pareto<T extends { spend: number }>(rows: T[], cut = 80) {
  const total = rows.reduce((s, r) => s + r.spend, 0);
  let acc = 0;
  return [...rows].sort((a, b) => b.spend - a.spend).map((r) => { const before = acc; acc += r.spend; return { ...r, share: total ? Math.round(r.spend / total * 1000) / 10 : 0, cumulative: total ? Math.round(acc / total * 1000) / 10 : 0, top: total ? before / total * 100 < cut : false }; });
}
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
/** Prishöjning på återkommande inköp: senaste fakturan mot medianen av de tidigare (minst tre fakturor) */
export function priceIncrease(amounts: number[], threshold = 5) {
  if (amounts.length < 3) return null;
  const last = amounts[amounts.length - 1], base = median(amounts.slice(0, -1));
  const spread = Math.max(...amounts.slice(0, -1)) / Math.max(1, Math.min(...amounts.slice(0, -1)));
  if (spread > 1.25) return null; // inte ett återkommande belopp
  const pct = base > 0 ? Math.round((last - base) / base * 1000) / 10 : 0;
  return pct >= threshold ? pct : null;
}
