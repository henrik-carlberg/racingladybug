// Utlägg och reseräkningar: ersättningar utan databas. Belopp i öre.

/** Milersättning: kilometer × öre per mil / 10 */
export const mileage = (km: number, ratePerMil: number) => Math.round((km / 10) * ratePerMil);

/** Traktamente: hela dagar, halva dagar och nätter */
export const allowance = (full: number, half: number, nights: number, r: { full: number; half: number; night: number }) => full * r.full + half * r.half + nights * r.night;

/** Momsen i ett belopp inklusive moms */
export const vatPart = (gross: number, rate: number) => (rate ? Math.round((gross * rate) / (100 + rate)) : 0);

export interface ClaimLine { kind: 'receipt' | 'mileage' | 'allowance'; amount: number; vat: number; account: number; description: string }

/** Kontering vid attest: kostnader och moms mot skuld till den anställda */
export function approvalEntries(lines: ClaimLine[], liabilityAccount: number) {
  const byAcc = new Map<number, number>();
  let vat = 0, total = 0;
  for (const l of lines) {
    byAcc.set(l.account, (byAcc.get(l.account) ?? 0) + l.amount - l.vat);
    vat += l.vat; total += l.amount;
  }
  return [
    ...[...byAcc.entries()].map(([account, amount]) => ({ account, amount })),
    ...(vat ? [{ account: 2641, amount: vat }] : []),
    { account: liabilityAccount, amount: -total },
  ];
}

/** Avdrag för måltider som arbetsgivaren betalar, i procent av normalbeloppet för en hel dag (frukost 20 %, lunch och middag 35 % var) */
export const MEAL_PCT = { breakfast: 20, lunch: 35, dinner: 35 } as const;
/** Långvarig förrättning på samma ort: efter tre månader 70 %, efter två år 50 % av normalbeloppet */
export const LONG_TERM: Record<string, number> = { '': 100, '3m': 70, '2y': 50 };
/** Bilersättning per mil för förmånsbil: el 9,50 kr, övriga drivmedel 12 kr (kontrollera Skatteverkets belopp varje år) */
export const BENEFIT_CAR_RATE: Record<string, number> = { el: 950, fossil: 1200 };

/**
 * Traktamente med normalbelopp (inrikes enligt inställningarna eller utrikes för landet), måltidsavdrag och långvarig förrättning.
 * Nattraktamentet påverkas inte av måltider. Beloppet blir aldrig negativt.
 */
export function allowanceDetailed(o: { full: number; half: number; nights: number; normal: number; halfRate?: number; night: number; meals: { breakfast: number; lunch: number; dinner: number }; longTerm?: string }) {
  const f = (LONG_TERM[o.longTerm ?? ''] ?? 100) / 100;
  const days = Math.round((o.full * o.normal + o.half * (o.halfRate ?? Math.round(o.normal / 2))) * f);
  const meals = Math.round((o.meals.breakfast * MEAL_PCT.breakfast + o.meals.lunch * MEAL_PCT.lunch + o.meals.dinner * MEAL_PCT.dinner) / 100 * o.normal * f);
  const amount = Math.max(0, days - meals) + o.nights * o.night;
  return { amount, days, meals, nights: o.nights * o.night };
}

/** Ersättning över det skattefria beloppet är lön: den skattefria delen ersätts här, överskjutande del betalas via lönen */
export const excess = (paid: number, taxFree: number) => Math.max(0, paid - taxFree);
