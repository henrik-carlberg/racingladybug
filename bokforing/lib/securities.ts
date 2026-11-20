// Värdepapper och placeringar (ren logik). Belopp i öre; rader med positivt belopp = debet.
export type SecurityKind = 'listed' | 'unlisted' | 'fund' | 'crypto' | 'bond';
export type Holding = 'fixed' | 'current';
export interface SignedLine { account: number; amount: number }

export const KIND_LABEL: Record<SecurityKind, string> = { listed: 'Marknadsnoterade aktier', unlisted: 'Onoterade aktier', fund: 'Fondandelar', crypto: 'Kryptotillgångar', bond: 'Obligationer' };
/** Schablonintäkt på fondandelar som ägs vid årets ingång (inkomstskattelagen 39 a kap.) */
export const FUND_STANDARD_RATE = 0.004;

/** Konton enligt BAS: anläggningstillgångar (1350, 82xx) eller kortfristiga placeringar (1810/1880, 83xx) */
export function accounts(kind: SecurityKind, holding: Holding) {
  if (holding === 'fixed') return { asset: 1350, contra: 1359, dividend: 8210, gain: 8220, writedown: 8270, interest: 8250 };
  return kind === 'crypto'
    ? { asset: 1880, contra: 1889, dividend: 8340, gain: 8350, writedown: 8320, interest: 8310 }
    : { asset: 1810, contra: 1819, dividend: 8340, gain: 8350, writedown: 8320, interest: 8310 };
}

/** Delägarrätter (aktier, fondandelar) – för dem gäller näringsbetingning och kvittningsregeln */
export const isShareRight = (k: SecurityKind) => k === 'listed' || k === 'unlisted' || k === 'fund';

/**
 * Näringsbetingade andelar: onoterade aktier alltid, marknadsnoterade om innehavet är minst 10 % av rösterna
 * eller betingat av rörelsen (markeras på innehavet). Utdelning och kapitalvinst är skattefria, förlust ej avdragsgill.
 */
export const isBusinessRelated = (k: SecurityKind, flagged: boolean) => k === 'unlisted' || (k === 'listed' && flagged);

export interface Trade { kind: 'buy' | 'sell' | 'dividend' | 'interest'; date: string; quantity: number; amount: number; fee: number }

/** Innehav med genomsnittsmetoden */
export function position(trades: Trade[]) {
  let qty = 0, cost = 0;
  for (const t of [...trades].sort((a, b) => a.date.localeCompare(b.date))) {
    if (t.kind === 'buy') { qty += t.quantity; cost += t.amount + t.fee; }
    else if (t.kind === 'sell') { const c = qty ? Math.round((cost * t.quantity) / qty) : 0; qty -= t.quantity; cost -= c; }
  }
  return { quantity: Math.round(qty * 1e8) / 1e8, cost, average: qty ? cost / qty : 0 };
}

export function buyLines(acc: ReturnType<typeof accounts>, amount: number, fee: number, bank: number): SignedLine[] {
  return [{ account: acc.asset, amount: amount + fee }, { account: bank, amount: -(amount + fee) }];
}

export function saleResult(pos: { quantity: number; cost: number }, quantity: number, proceeds: number, fee: number) {
  if (quantity <= 0 || quantity > pos.quantity + 1e-9) throw new Error(`Det finns bara ${pos.quantity} i innehavet`);
  const cost = quantity >= pos.quantity - 1e-9 ? pos.cost : Math.round((pos.cost * quantity) / pos.quantity);
  return { cost, net: proceeds - fee, gain: proceeds - fee - cost };
}

/** Försäljning: bank mot innehavet till genomsnittligt anskaffningsvärde, vinst eller förlust på resultatkontot */
export function saleLines(acc: ReturnType<typeof accounts>, r: { cost: number; net: number; gain: number }, bank: number): SignedLine[] {
  return [{ account: bank, amount: r.net }, { account: acc.asset, amount: -r.cost }, { account: acc.gain, amount: -r.gain }].filter((l) => l.amount);
}

export function incomeLines(acc: ReturnType<typeof accounts>, kind: 'dividend' | 'interest', amount: number, bank: number): SignedLine[] {
  return [{ account: bank, amount }, { account: kind === 'dividend' ? acc.dividend : acc.interest, amount: -amount }];
}

/**
 * Värdering i bokslutet: kortfristiga placeringar till lägsta värdets princip, anläggningstillgångar bara vid bestående värdenedgång.
 * Returnerar ändringen av nedskrivningen (positiv = ökad nedskrivning) mot det som redan är nedskrivet.
 */
export function writedown(i: { holding: Holding; cost: number; market: number; current: number; permanent: boolean }) {
  const target = i.holding === 'current' || i.permanent ? Math.max(0, i.cost - i.market) : 0;
  return { target, change: target - i.current };
}
export function writedownLines(acc: ReturnType<typeof accounts>, change: number): SignedLine[] {
  return change ? [{ account: acc.writedown, amount: change }, { account: acc.contra, amount: -change }] : [];
}

export interface TaxRow { id: number; name: string; kind: SecurityKind; businessRelated: boolean; dividends: number; gains: number; writedowns: number; fundValueStart: number }
/** Skattemässiga justeringar för året */
export function taxSummary(rows: TaxRow[]) {
  let exemptIncome = 0, nonDeductible = 0, shareGains = 0, shareLosses = 0, standard = 0;
  for (const r of rows) {
    if (r.businessRelated) {
      exemptIncome += r.dividends + Math.max(0, r.gains);
      nonDeductible += Math.max(0, -r.gains) + r.writedowns;
      continue;
    }
    if (isShareRight(r.kind)) { if (r.gains > 0) shareGains += r.gains; else shareLosses += -r.gains; }
    if (r.kind === 'fund') standard += Math.round(r.fundValueStart * FUND_STANDARD_RATE);
    // Nedskrivning av kapitalplaceringar är inte avdragsgill förrän förlusten realiseras
    nonDeductible += r.writedowns;
  }
  // Förlust på delägarrätter som kapitalplacering får bara dras av mot vinst på delägarrätter (IL 48 kap. 26 §)
  const lossNotDeductible = Math.max(0, shareLosses - shareGains);
  nonDeductible += lossNotDeductible;
  return { exemptIncome, nonDeductible, standardIncome: standard, lossNotDeductible, taxableAdjustment: nonDeductible + standard - exemptIncome };
}
