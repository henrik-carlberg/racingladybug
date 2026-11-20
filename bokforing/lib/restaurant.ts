// Hotell och restaurang (ren logik): dagskassa med dricks, personalmat (kostförmån och uttagsmoms) och representation med blandad moms. Belopp i öre.
import { ACC } from './bas';
import { PAYMENT_ACCOUNTS, splitGross, type PaymentMethod } from './shop';

export const TIPS_LIABILITY = 2897;   // Dricks att betala ut till personalen (kortdricks är inte bolagets intäkt)
export const MEAL_COST = 7389;        // Övriga kostnader för förmåner (uttagsmoms på personalmat)
export const VAT_12 = ACC.vatOut[12];  // Utgående moms 12 % (samma konto som försäljningen, så att momsdeklarationen tar med den)
export const REP_DEDUCTIBLE_BASE = 30000; // Momsavdrag på högst 300 kr exkl. moms per person och tillfälle (måltid)

/** Skatteverkets schablonvärden för kostförmån (öre per måltid). Senaste kända år används tills nya värden läggs in – värdena kan ändras i formuläret. */
export const MEAL_VALUES: Record<number, { breakfast: number; lunch: number; dinner: number }> = {
  2024: { breakfast: 6200, lunch: 12400, dinner: 12400 },
  2025: { breakfast: 6500, lunch: 13000, dinner: 13000 },
};
export const mealValuesFor = (year: number) => MEAL_VALUES[year] ?? MEAL_VALUES[Math.max(...Object.keys(MEAL_VALUES).map(Number).filter((y) => y <= year))] ?? MEAL_VALUES[2025];

/**
 * Dagskassa för restaurang: mat (12 %) och dryck med alkohol (25 %) inkl. moms, betalningar per betalsätt och kortdricks.
 * Betalningarna ska motsvara försäljningen plus dricksen; dricksen bokas som skuld till personalen.
 */
export function restaurantZLines(o: { food: number; alcohol: number; other25?: number; tips: number; payments: Partial<Record<PaymentMethod, number>>; maxDiff?: number }) {
  const sales = splitGross({ 12: o.food, 25: o.alcohol + (o.other25 ?? 0) });
  const totalSales = sales.reduce((s, x) => s + x.gross, 0);
  const totalPay = Object.values(o.payments).reduce((s, v) => s + (v ?? 0), 0);
  const diff = totalPay - totalSales - o.tips;
  if (Math.abs(diff) > (o.maxDiff ?? 0)) throw new Error(`Betalningarna (${totalPay / 100} kr) ska vara försäljningen (${totalSales / 100} kr) plus dricksen (${o.tips / 100} kr)`);
  const lines: { account: number; amount: number; description?: string }[] = [
    ...Object.entries(o.payments).filter(([, v]) => v).map(([m, v]) => ({ account: PAYMENT_ACCOUNTS[m as PaymentMethod], amount: v! })),
    ...sales.flatMap((x) => [{ account: ACC.sales[x.rate], amount: -x.net }, ...(x.vat ? [{ account: ACC.vatOut[x.rate], amount: -x.vat }] : [])]),
  ];
  if (o.tips) lines.push({ account: TIPS_LIABILITY, amount: -o.tips, description: 'Kortdricks till personalen' });
  if (diff) lines.push({ account: ACC.rounding, amount: -diff, description: 'Kassadifferens' });
  return { lines, sales, totalSales, diff };
}

/**
 * Personalmat: förmånsvärde enligt schablon per måltid minus vad den anställde betalat (skattepliktig förmån till lönen),
 * och uttagsmoms 12 % på förmånsvärdet (som anses inkludera moms).
 */
export function mealBenefit(o: { breakfasts: number; lunches: number; dinners: number; paid: number }, v: { breakfast: number; lunch: number; dinner: number }) {
  const value = o.breakfasts * v.breakfast + o.lunches * v.lunch + o.dinners * v.dinner;
  const taxable = Math.max(0, value - Math.max(0, o.paid));
  const vat = Math.round((value * 12) / 112);
  return { value, taxable, vat };
}
export function mealVatLines(vat: number) {
  return [{ account: MEAL_COST, amount: vat }, { account: VAT_12, amount: -vat }];
}

/**
 * Representation (affärsmåltid) med mat 12 % och dryck 25 %: kostnaden är inte avdragsgill (6072), momsen får dras av på högst
 * 300 kr exkl. moms per person – fördelat på momssatserna i proportion till underlaget.
 */
export function representationLines(o: { food: number; drinks: number; persons: number; bank?: number }) {
  const s = splitGross({ 12: o.food, 25: o.drinks });
  const net = s.reduce((a, x) => a + x.net, 0);
  const cap = Math.max(1, o.persons) * REP_DEDUCTIBLE_BASE;
  const factor = net > 0 ? Math.min(1, cap / net) : 0;
  const deductible = s.reduce((a, x) => a + Math.round(x.vat * factor), 0);
  const vat = s.reduce((a, x) => a + x.vat, 0);
  const gross = o.food + o.drinks;
  return { lines: [{ account: 6072, amount: gross - deductible }, ...(deductible ? [{ account: ACC.vatIn, amount: deductible }] : []), { account: o.bank ?? 1930, amount: -gross }], deductible, vat, nonDeductibleVat: vat - deductible };
}
