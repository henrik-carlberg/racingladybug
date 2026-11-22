import { vatShare, type SignedLine } from '@/lib/bad-debts';
// Förlikning i en tvist om en kundfaktura. Belopp i öre.
export const REDUCTION_ACCOUNT = 3730; // Lämnade rabatter (nedsättning av priset)
export const RECEIVABLE = 1510;

/** Nedsättningen enligt förlikningen: intäkten och utgående moms minskas i samma proportion som på fakturan (ML 15 kap.), fordran minskas */
export function reductionLines(invoiceLines: { account: number; amount: number }[], reduction: number): SignedLine[] {
  const s = vatShare(invoiceLines, reduction);
  return [{ account: REDUCTION_ACCOUNT, amount: s.net }, ...s.vat.map((v) => ({ account: v.account, amount: v.amount })), { account: RECEIVABLE, amount: -reduction }].filter((l) => l.amount);
}
