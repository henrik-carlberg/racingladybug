// Fusion av helägt dotterbolag (aktiebolagslagen 23 kap. 28 §) enligt andelsvärdemetoden. Saldo = debet − kredit i öre.
export type Treatment = 'equity' | 'goodwill';
export interface SignedLine { account: number; amount: number }
export const SHARES = 1311, GOODWILL = 1070, RETAINED = 2091;

const transferred = (n: number) => (n >= 1000 && n <= 1999) || (n >= 2100 && n <= 2999);

/** Det som tas över: tillgångar, obeskattade reserver, avsättningar och skulder till dotterbolagets bokförda värden */
export function takeover(subBalances: Map<number, number>, shareValue: number) {
  const items = [...subBalances].filter(([n, v]) => v && transferred(n)).sort((a, b) => a[0] - b[0]).map(([account, amount]) => ({ account, amount }));
  const net = items.reduce((s, i) => s + i.amount, 0);
  return { items, net, shareValue, difference: net - shareValue };
}

/**
 * Moderbolaget: dotterbolagets poster in, aktierna i dotterbolaget ut. En positiv fusionsdifferens (vinster i dotterbolaget efter förvärvet)
 * förs till eget kapital; en negativ förs mot eget kapital eller som goodwill om den motsvaras av ett övervärde.
 */
export function parentLines(t: ReturnType<typeof takeover>, treatment: Treatment): SignedLine[] {
  const l: SignedLine[] = [...t.items, { account: SHARES, amount: -t.shareValue }];
  if (t.difference > 0) l.push({ account: RETAINED, amount: -t.difference });
  else if (t.difference < 0) l.push({ account: treatment === 'goodwill' ? GOODWILL : RETAINED, amount: -t.difference });
  return l.filter((x) => x.amount);
}

/** Dotterbolaget: posterna förs ut mot eget kapital per fusionsdagen */
export function subsidiaryLines(t: ReturnType<typeof takeover>): SignedLine[] {
  return [...t.items.map((i) => ({ account: i.account, amount: -i.amount })), { account: RETAINED, amount: t.net }].filter((x) => x.amount);
}
