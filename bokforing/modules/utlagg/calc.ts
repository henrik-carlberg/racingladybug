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
