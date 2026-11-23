// Klientmedel. Belopp i öre; rader med positivt belopp = debet.
export interface SignedLine { account: number; amount: number }
export const DEFAULTS = { bank: 1940, liability: 2890 };
export type Kind = 'deposit' | 'payout' | 'fee';

/** Insättning: pengarna kommer in på klientmedelskontot och är en skuld till klienten. Utbetalning och arvode minskar skulden. */
export function entryLines(kind: Kind, amount: number, o: { bank: number; liability: number }): SignedLine[] {
  return kind === 'deposit' ? [{ account: o.bank, amount }, { account: o.liability, amount: -amount }] : [{ account: o.liability, amount }, { account: o.bank, amount: -amount }];
}
export const signed = (kind: Kind, amount: number) => (kind === 'deposit' ? amount : -amount);

/** Saldot får aldrig bli negativt – en klients medel får inte användas för en annan */
export function nextBalance(balance: number, kind: Kind, amount: number) {
  const next = balance + signed(kind, amount);
  if (next < 0) throw new Error(`Klienten har bara ${(balance / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2 })} kr – en klients medel får inte användas för en annan`);
  return next;
}

/** Avstämning: bankkontot och skuldkontot ska båda motsvara summan av klienternas saldon */
export function reconcile(o: { clients: number; bank: number; liability: number }) {
  return { bankDiff: o.bank - o.clients, liabilityDiff: o.liability - o.clients, ok: o.bank === o.clients && o.liability === o.clients };
}
