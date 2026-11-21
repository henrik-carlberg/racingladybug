// Valutaterminer: säkring av fordringar och skulder i utländsk valuta, värdering i bokslutet och resultat vid förfall. Belopp i öre.
export type Direction = 'sell' | 'buy';
export interface SignedLine { account: number; amount: number }
export const FX_GAIN = 3960, FX_LOSS = 7960, FIN_COST = 8390, ACCRUED = 2990;

/** Terminens värde mot en kurs: säljer bolaget valutan vinner det när kursen faller under terminskursen */
export function value(dir: Direction, amount: number, forwardRate: number, rate: number) {
  const diff = dir === 'sell' ? forwardRate - rate : rate - forwardRate;
  return Math.round(diff * amount * 100);
}

/**
 * Bokslut för en osäkrad termin: enligt försiktighetsprincipen (lägsta värdets princip) reserveras ett orealiserat undervärde;
 * ett övervärde tas inte upp. En termin som säkrar en fordran eller skuld värderas inte separat – den säkrade posten tas upp till terminskursen.
 */
export function yearEnd(o: { dir: Direction; amount: number; forwardRate: number; closingRate: number; hedging: boolean; reserved: number }) {
  if (o.hedging) return { value: value(o.dir, o.amount, o.forwardRate, o.closingRate), reserve: 0, change: o.reserved ? -o.reserved : 0 };
  const v = value(o.dir, o.amount, o.forwardRate, o.closingRate);
  const reserve = Math.max(0, -v);
  return { value: v, reserve, change: reserve - o.reserved };
}
export const reserveLines = (change: number): SignedLine[] => change ? [{ account: FIN_COST, amount: change }, { account: ACCRUED, amount: -change }] : [];

/** Förfall med nettoavräkning: resultatet mot banken, en tidigare reserv löses upp */
export function settleLines(result: number, reserved: number, bank = 1930): SignedLine[] {
  const l: SignedLine[] = [{ account: bank, amount: result }, result >= 0 ? { account: FX_GAIN, amount: -result } : { account: FX_LOSS, amount: -result }];
  if (reserved) l.push({ account: ACCRUED, amount: reserved }, { account: FIN_COST, amount: -reserved });
  return l.filter((x) => x.amount);
}
