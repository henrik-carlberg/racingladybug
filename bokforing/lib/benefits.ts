// Skattefria personalförmåner med tak per anställd och år (Skatteverkets belopp – kontrollera på skatteverket.se varje år). Ren logik, öre.

export const BENEFITS = {
  wellness: { label: 'Friskvårdsbidrag', cap: 500000, allOrNothing: true, help: 'Högst 5 000 kr per år inkl. moms. Blir summan högre är hela bidraget skattepliktigt.' },
  christmas: { label: 'Julgåva', cap: 55000, allOrNothing: true, help: 'Högst 550 kr inkl. moms. Kostar gåvan mer är hela värdet skattepliktigt.' },
  anniversary: { label: 'Jubileumsgåva', cap: 180000, allOrNothing: true, help: 'Högst 1 800 kr inkl. moms, när den anställde fyller 50 år eller efter 20 och 40 års anställning.' },
  memorial: { label: 'Minnesgåva', cap: 1500000, allOrNothing: true, help: 'Högst 15 000 kr inkl. moms vid minst 25 års anställning, en gång.' },
} as const;
export type BenefitKind = keyof typeof BENEFITS;
export const isBenefitKind = (k: string): k is BenefitKind => k in BENEFITS;

/** Ryms den nya förmånen inom årets tak? */
export function checkBenefit(kind: BenefitKind, usedThisYear: number, amount: number) {
  const b = BENEFITS[kind];
  if (amount <= 0) return { ok: false, left: Math.max(0, b.cap - usedThisYear), message: 'Ange ett belopp' };
  const left = Math.max(0, b.cap - usedThisYear);
  if (usedThisYear + amount <= b.cap) return { ok: true, left: left - amount, message: '' };
  return { ok: false, left, message: `${b.label} ryms inte inom det skattefria taket: ${(left / 100).toLocaleString('sv-SE')} kr kvar i år. ${b.help}` };
}
