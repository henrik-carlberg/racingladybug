// Ombildning från enskild firma till aktiebolag genom underprisöverlåtelse (ren logik). Saldo = debet − kredit i öre.
import { EXPANSION_TAX } from './ef-tax';

export type Payment = 'debt' | 'contribution';
export interface SignedLine { account: number; amount: number }
export const OWNER_DEBT = 2893;
export const CONTRIBUTION = 2093;
export const WITHDRAWAL = 2013;
export const PFOND_REVERSAL = 8819;

const isTransferred = (n: number) => (n >= 1000 && n <= 1999) || (n >= 2200 && n <= 2999);
const isPfond = (n: number) => n >= 2110 && n <= 2149;

/** Det som förs över: tillgångar och skulder till bokfört värde; periodiseringsfonder och expansionsfond stannar i firman */
export function split(balances: Map<number, number>) {
  const items = [...balances].filter(([n, v]) => v && isTransferred(n)).sort((a, b) => a[0] - b[0]).map(([account, amount]) => ({ account, amount }));
  const assets = items.filter((i) => i.account < 2000).reduce((s, i) => s + i.amount, 0);
  const liabilities = -items.filter((i) => i.account >= 2000).reduce((s, i) => s + i.amount, 0);
  const pfonds = [...balances].filter(([n, v]) => v && isPfond(n)).map(([account, amount]) => ({ account, amount: -amount }));
  return { items, assets, liabilities, net: assets - liabilities, pfonds, pfondTotal: pfonds.reduce((s, p) => s + p.amount, 0), expansion: -(balances.get(2050) ?? 0) };
}

/** Aktiebolaget tar upp tillgångar och skulder; köpeskillingen blir en skuld till ägaren eller ett ovillkorat aktieägartillskott */
export function abLines(s: ReturnType<typeof split>, payment: Payment): SignedLine[] {
  if (s.net <= 0) throw new Error('Skulderna överstiger tillgångarna – en underprisöverlåtelse kräver ett positivt nettovärde');
  return [...s.items, { account: payment === 'debt' ? OWNER_DEBT : CONTRIBUTION, amount: -s.net }];
}

/** Firman lämnar ifrån sig tillgångar och skulder; nettot förs som eget uttag (ägaren får fordran eller tillskottet i bolaget) */
export function efLines(s: ReturnType<typeof split>): SignedLine[] {
  return [...s.items.map((i) => ({ account: i.account, amount: -i.amount })), { account: WITHDRAWAL, amount: s.net }];
}

/** När verksamheten upphör återförs periodiseringsfonderna som intäkt och expansionsfonden till eget kapital */
export function closingFundLines(s: ReturnType<typeof split>): SignedLine[] {
  const l: SignedLine[] = [];
  for (const p of s.pfonds) l.push({ account: p.account, amount: p.amount });
  if (s.pfondTotal) l.push({ account: PFOND_REVERSAL, amount: -s.pfondTotal });
  if (s.expansion) l.push({ account: 2050, amount: s.expansion }, { account: 2010, amount: -s.expansion });
  return l;
}

/** Slutlig NE: resultatet (med återförda periodiseringsfonder) plus återförd expansionsfond; expansionsfondsskatten tillgodoräknas */
export function finalNe(o: { result: number; pfondTotal: number; expansion: number }) {
  return { result: o.result, pfondReversed: o.pfondTotal, expansionReversed: o.expansion, taxable: o.result + o.expansion, expansionTaxCredit: Math.round(o.expansion * EXPANSION_TAX) };
}
