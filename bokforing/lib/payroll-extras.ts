// Lönetillägg: bilförmån, tjänstepension och semesterlön enligt procentregeln – ren logik (testbar)

/** Prisbasbelopp och statslåneränta som används i beräkningen av bilförmån. Kontrollera mot Skatteverket varje år. */
export const CAR_DEFAULTS: Record<number, { pbb: number; slr: number }> = {
  2026: { pbb: 5_920_000, slr: 2.55 },
  2027: { pbb: 5_920_000, slr: 2.55 },
};

/**
 * Bilförmånsvärde per år (Skatteverkets schablon för bilar från 2021-07-01):
 *   0,29 × prisbasbeloppet + nybilspris × (0,70 × statslåneräntan + 1 %) + 13 % av nybilspriset + fordonsskatt
 * Nybilspris inkl. extrautrustning, efter eventuell nedsättning för miljöbil. Belopp i öre.
 */
export function carBenefitYearly(o: { newCarPrice: number; extras?: number; reduction?: number; vehicleTax: number; pbb: number; slr: number }) {
  const price = Math.max(0, o.newCarPrice + (o.extras ?? 0) - (o.reduction ?? 0));
  const value = 0.29 * o.pbb + price * ((0.7 * o.slr) / 100 + 0.01) + 0.13 * price + o.vehicleTax;
  return Math.round(value / 100) * 100; // hela kronor
}
export const carBenefitMonthly = (yearly: number) => Math.round(yearly / 12 / 100) * 100;

/** Särskild löneskatt på pensionskostnader */
export const SLP_RATE = 24.26;
export function pensionCost(grossCash: number, percent: number) {
  const premium = Math.max(0, Math.round((grossCash * percent) / 100));
  return { premium, slp: Math.round((premium * SLP_RATE) / 100) };
}

/**
 * Semesterlön enligt procentregeln: 12 % av semesterlönegrundande lön under intjänandeåret,
 * fördelat på antalet betalda semesterdagar. Tas lön ut som vanligt (månadslön) dras dagslönen av.
 */
export function percentRuleVacation(o: { earnedLastYear: number; paidDays: number; daysTaken: number; monthly: number }) {
  if (o.daysTaken <= 0 || o.paidDays <= 0) return { dayPay: 0, pay: 0, deduction: 0 };
  const dayPay = Math.round((0.12 * o.earnedLastYear) / o.paidDays);
  const pay = Math.round(dayPay * o.daysTaken);
  // Månadsavlönade: avdrag med 4,6 % av månadslönen per semesterdag (motsvarar en dags lön)
  const deduction = o.monthly ? Math.round(o.monthly * 0.046 * o.daysTaken) : 0;
  return { dayPay, pay, deduction };
}
