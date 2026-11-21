// Lån till anställda: förmånsränta och månadens avdrag (ren logik). Belopp i öre, räntor i procent.

/** Statslåneräntan den 30 november året före inkomståret (Skatteverket – kontrollera varje år) */
export const GOVERNMENT_RATE: Record<number, number> = { 2024: 2.62, 2025: 1.96, 2026: 2.55 };
/** Förmånsränta: statslåneräntan plus en procentenhet */
export const benefitRate = (year: number) => (GOVERNMENT_RATE[year] ?? GOVERNMENT_RATE[Math.max(...Object.keys(GOVERNMENT_RATE).map(Number))]) + 1;

/** Månadens ränteförmån: skillnaden mellan förmånsräntan och den avtalade räntan på lånets saldo */
export const monthlyBenefit = (balance: number, agreedRate: number, year: number) => Math.max(0, Math.round((balance * (benefitRate(year) - agreedRate)) / 100 / 12));
export const monthlyInterest = (balance: number, agreedRate: number) => Math.max(0, Math.round((balance * agreedRate) / 100 / 12));

/** Lönerader för månaden: amortering (högst saldot) och avtalad ränta som nettolöneavdrag, ränteförmån som skattepliktig förmån */
export function loanItems(l: { balance: number; agreedRate: number; installment: number }, year: number) {
  const amortization = Math.min(l.installment, l.balance);
  const interest = monthlyInterest(l.balance, l.agreedRate);
  const benefit = monthlyBenefit(l.balance, l.agreedRate, year);
  return {
    amortization, interest, benefit,
    items: [
      ...(amortization + interest ? [{ type: 'net_deduction' as const, description: `Medarbetarlån: amortering${interest ? ' och ränta' : ''}`, amount: amortization + interest, code: 'loan' as const }] : []),
      ...(benefit ? [{ type: 'benefit' as const, description: 'Ränteförmån medarbetarlån', amount: benefit, code: 'loan' as const }] : []),
    ],
  };
}
