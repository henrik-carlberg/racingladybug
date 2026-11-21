// Vinstmarginalbeskattning (VMB), förenklad metod: marginalen räknas per period på alla VMB-varor (ren logik). Belopp i öre.
export const VMB = { sales: 3211, base: 3213, purchases: 4012, vat: 2611 } as const;
/** Förenklad metod får användas för varor med inköpspris högst 50 000 kr styck */
export const SIMPLE_LIMIT = 5000000;

/** Periodens marginal: försäljning minus inköp minus negativ marginal från tidigare perioder. Momsen är 20 % av en positiv marginal (25/125). */
export function settle(o: { sales: number; purchases: number; carriedIn: number }) {
  const margin = o.sales - o.purchases - o.carriedIn;
  if (margin <= 0) return { margin, vat: 0, base: 0, carryOut: -margin };
  const vat = Math.round(margin * 0.2);
  return { margin, vat, base: margin - vat, carryOut: 0 };
}

/** Avräkningen: momsen och beskattningsunderlaget flyttas från försäljningskontot (underlaget till ruta 07) */
export const settleLines = (vat: number, base: number) => vat ? [{ account: VMB.sales, amount: vat + base }, { account: VMB.vat, amount: -vat }, { account: VMB.base, amount: -base }] : [];
