// Personalfester och intern representation (ren logik). Belopp i öre exkl. moms om inget annat anges.
/** Moms på mat och dryck får dras av för högst 300 kr exkl. moms per person; övriga kostnader (lokal, underhållning) dras av med högst 180 kr per person */
export const MEAL_VAT_CAP = 30000, OTHER_CAP = 18000;
export const ACCOUNTS = { deductible: 7631, nonDeductible: 7632, vatIn: 2641, bank: 1930 } as const;
/** Högst två personalfester per år är skattefria för de anställda */
export const FREE_EVENTS_PER_YEAR = 2;

export function eventBooking(o: { persons: number; meal: number; mealVat: number; other: number; otherVat: number }) {
  const n = Math.max(1, o.persons);
  const mealShare = o.meal ? Math.min(1, (n * MEAL_VAT_CAP) / o.meal) : 0;
  const otherShare = o.other ? Math.min(1, (n * OTHER_CAP) / o.other) : 0;
  const mealVatDed = Math.round(o.mealVat * mealShare);
  const otherDed = Math.round(o.other * otherShare), otherVatDed = Math.round(o.otherVat * otherShare);
  const vatDed = mealVatDed + otherVatDed;
  // Måltiden är inte avdragsgill för inkomstskatt; övriga kostnader upp till 180 kr per person är det
  const nonDed = o.meal + (o.mealVat - mealVatDed) + (o.other - otherDed) + (o.otherVat - otherVatDed);
  const total = o.meal + o.mealVat + o.other + o.otherVat;
  return { vatDed, deductible: otherDed, nonDeductible: nonDed, total, perPerson: Math.round(total / n),
    lines: [...(otherDed ? [{ account: ACCOUNTS.deductible, amount: otherDed }] : []), ...(nonDed ? [{ account: ACCOUNTS.nonDeductible, amount: nonDed }] : []),
      ...(vatDed ? [{ account: ACCOUNTS.vatIn, amount: vatDed }] : []), { account: ACCOUNTS.bank, amount: -total }] };
}

/** Förmånsvarning: tredje festen samma år, eller kostnad per person över ert riktvärde */
export function benefitWarning(o: { eventsThisYear: number; perPerson: number; guideline: number | null }) {
  const w: string[] = [];
  if (o.eventsThisYear >= FREE_EVENTS_PER_YEAR) w.push(`Det här är årets ${o.eventsThisYear + 1}:e personalfest – fler än två per år kan bli en skattepliktig förmån för de anställda`);
  if (o.guideline && o.perPerson > o.guideline) w.push(`Kostnaden per person (${Math.round(o.perPerson / 100)} kr) är över ert riktvärde (${Math.round(o.guideline / 100)} kr) – en påkostad fest kan bli skattepliktig`);
  return w;
}
