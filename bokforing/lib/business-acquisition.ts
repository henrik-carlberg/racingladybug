// Förvärv av rörelse (inkråmsköp): köpeskillingen fördelas på identifierbara tillgångar och övertagna skulder, resten är goodwill. Belopp i öre.
export interface SignedLine { account: number; amount: number }
export interface Item { account: number; label: string; amount: number }

/**
 * Goodwill = köpeskilling + övertagna skulder − identifierbara tillgångar. En negativ goodwill betyder att tillgångarna är övervärderade
 * eller att köpet är förmånligt – värdena ska då prövas i stället för att bokföras som negativ goodwill.
 */
export function allocate(price: number, assets: Item[], liabilities: Item[]) {
  const a = assets.reduce((s, i) => s + i.amount, 0), l = liabilities.reduce((s, i) => s + i.amount, 0);
  const goodwill = price + l - a;
  return { assets: a, liabilities: l, goodwill };
}

/** Verifikationen: tillgångar och goodwill i debet, övertagna skulder och betalningen (bank eller skuld till säljaren) i kredit */
export function acquisitionLines(price: number, assets: Item[], liabilities: Item[], payTo: number): SignedLine[] {
  const g = allocate(price, assets, liabilities).goodwill;
  if (g < 0) throw new Error('Tillgångarna överstiger köpeskillingen plus skulderna – pröva värderingen (negativ goodwill bokförs inte)');
  return [...assets.map((i) => ({ account: i.account, amount: i.amount })), ...(g ? [{ account: 1070, amount: g }] : []),
    ...liabilities.map((i) => ({ account: i.account, amount: -i.amount })), { account: payTo, amount: -price }].filter((l) => l.amount);
}

/** Skattemässigt skrivs goodwill av som inventarier (räkenskapsenlig avskrivning, 30-regeln eller 20-regeln) */
export const taxNote = 'Goodwill och andra immateriella tillgångar skrivs av skattemässigt som inventarier (30- eller 20-regeln).';
