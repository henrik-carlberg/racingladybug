// Högkostnadsskydd för sjuklön (lag om ersättning för sjuklönekostnader): ersättning när årets sjuklönekostnad är hög i förhållande till lönekostnaden.
export const MAX_COMPENSATION = 25000000; // högst 250 000 kr per år
/** Andelen av sjuklönekostnaden som ersätts, efter sjuklönekostnadens andel av den totala lönekostnaden */
export const BANDS: { from: number; to: number; share: number }[] = [
  { from: 0.007, to: 0.011, share: 0.25 },
  { from: 0.011, to: 0.015, share: 0.5 },
  { from: 0.015, to: 0.025, share: 0.75 },
  { from: 0.025, to: Infinity, share: 1 },
];
export const RECEIVABLE = 1689, INCOME = 3990;

/** Sjuklönen på en lönespec: sjuklönerader minus karensavdrag */
export function sickPayOf(items: { description: string; amount: number }[]) {
  return items.filter((i) => /^Sjuklön\b/.test(i.description) || /^Karensavdrag/.test(i.description)).reduce((s, i) => s + i.amount, 0);
}

/**
 * Ersättningen räknas i trappsteg: för varje intervall ersätts den del av sjuklönekostnaden som ligger inom intervallet
 * (räknat som andel av den totala lönekostnaden) med intervallets andel.
 */
export function compensation(sickCost: number, totalCost: number) {
  if (sickCost <= 0 || totalCost <= 0) return { ratio: 0, amount: 0, rows: [] as { from: number; to: number; share: number; base: number; amount: number }[] };
  const ratio = sickCost / totalCost;
  const rows = BANDS.map((b) => {
    const lo = b.from * totalCost, hi = Math.min(b.to * totalCost, sickCost);
    const base = Math.max(0, Math.round(hi - lo));
    return { ...b, base, amount: Math.round(base * b.share) };
  }).filter((r) => r.base > 0);
  return { ratio, amount: Math.min(MAX_COMPENSATION, rows.reduce((s, r) => s + r.amount, 0)), rows };
}

export const claimLines = (amount: number) => (amount ? [{ account: RECEIVABLE, amount }, { account: INCOME, amount: -amount }] : []);
