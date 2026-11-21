// Försäljning av näringsfastighet: bokförd vinst mot bokförda värden och skattepliktig vinst med återförda värdeminskningsavdrag. Belopp i öre.
export interface SignedLine { account: number; amount: number }
export const GAIN = 3973, LOSS = 7973;

export interface BookValues { building: number; buildingDep: number; land: number; improvement: number; improvementDep: number }

/** Bokföringen: banken (köpeskilling minus försäljningskostnader), anskaffningsvärden och ackumulerade avskrivningar ut, vinst eller förlust */
export function saleLines(price: number, costs: number, b: BookValues, bank = 1930): { lines: SignedLine[]; bookValue: number; result: number } {
  const bookValue = b.building - b.buildingDep + b.land + b.improvement - b.improvementDep;
  const result = price - costs - bookValue;
  const lines: SignedLine[] = [
    { account: bank, amount: price - costs },
    { account: 1119, amount: b.buildingDep }, { account: 1159, amount: b.improvementDep },
    { account: 1110, amount: -b.building }, { account: 1130, amount: -b.land }, { account: 1150, amount: -b.improvement },
    result >= 0 ? { account: GAIN, amount: -result } : { account: LOSS, amount: -result },
  ].filter((l) => l.amount);
  return { lines, bookValue, result };
}

/**
 * Skatten: kapitalvinst = köpeskilling minus försäljningskostnader minus anskaffningsutgifter och förbättringsutgifter;
 * gjorda värdeminskningsavdrag återförs (ingår i vinsten). Förlust på näringsfastighet får dras av mot vinster på näringsfastigheter.
 */
export function taxGain(o: { price: number; costs: number; acquisition: number; improvements: number; taxDepreciation: number }) {
  const adjustedBasis = o.acquisition + o.improvements - o.taxDepreciation;
  const gain = o.price - o.costs - adjustedBasis;
  return { adjustedBasis, gain, recaptured: Math.min(o.taxDepreciation, Math.max(0, gain)), capital: gain - Math.min(o.taxDepreciation, Math.max(0, gain)) };
}
