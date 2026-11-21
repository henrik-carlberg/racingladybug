// Inventarier av mindre värde och korttidsinventarier: direktavdrag eller aktivering (ren logik). Belopp i öre.
/** Prisbasbelopp per år (kontrollera mot Skatteverket varje år) */
export const PRICE_BASE: Record<number, number> = { 2024: 5730000, 2025: 5880000, 2026: 5920000 };
export const priceBase = (year: number) => PRICE_BASE[year] ?? PRICE_BASE[Math.max(...Object.keys(PRICE_BASE).map(Number))];
export const halfPriceBase = (year: number) => Math.round(priceBase(year) / 2);
export const EXPENSE_ACCOUNT = 5410;

export type Verdict = 'short_life' | 'small_value' | 'asset';
/** Bedömning: ekonomisk livslängd högst tre år ger alltid direktavdrag; annars direktavdrag om värdet (exkl. moms) understiger ett halvt prisbasbelopp */
export function classify(o: { price: number; lifeYears: number; related: number; year: number }) {
  const half = halfPriceBase(o.year);
  if (o.lifeYears <= 3) return { verdict: 'short_life' as Verdict, half, reason: 'Ekonomisk livslängd högst tre år: korttidsinventarie som dras av direkt' };
  const total = Math.max(o.price, o.related);
  if (total < half) return { verdict: 'small_value' as Verdict, half, reason: 'Inventarie av mindre värde: under ett halvt prisbasbelopp och dras av direkt' };
  return { verdict: 'asset' as Verdict, half, reason: o.related > o.price
    ? 'Inköpet ingår i en större anskaffning (en inventariesamling eller ett naturligt samband) som tillsammans är värd minst ett halvt prisbasbelopp och ska skrivas av'
    : 'Värdet är minst ett halvt prisbasbelopp: inventariet ska tas upp som tillgång och skrivas av' };
}

/** Flaggar kostnadsförda förbrukningsinventarier: enskilt belopp eller samma dag och leverantör över gränsen */
export function flag(rows: { voucherId: number; date: string; text: string; amount: number }[], year: number) {
  const half = halfPriceBase(year);
  const key = (r: { date: string; text: string }) => `${r.date}|${r.text.toLowerCase().split(/[\s,:]+/)[0] ?? ''}`;
  const groups = new Map<string, number>();
  for (const r of rows) groups.set(key(r), (groups.get(key(r)) ?? 0) + r.amount);
  return rows.map((r) => {
    const g = groups.get(key(r)) ?? r.amount;
    return { ...r, group: g, flagged: r.amount >= half ? 'single' as const : g >= half ? 'related' as const : null };
  }).filter((r) => r.flagged);
}

/** Omföring när ett direktavdraget inköp ska aktiveras */
export const activationLines = (amount: number, assetAccount: number) => [{ account: assetAccount, amount }, { account: EXPENSE_ACCOUNT, amount: -amount }];
