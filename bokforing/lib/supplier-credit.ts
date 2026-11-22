// Kreditfakturor från leverantörer (ren logik). Belopp i öre.
export const SUPPLIER_DEBTS = 2440, VAT_IN = 2641;

/** Kreditnotan bokas tillbaka: leverantörsskulden minskar mot kostnad och ingående moms */
export function creditLines(costs: { account: number; amount: number }[], vat: number) {
  const net = costs.reduce((s, c) => s + c.amount, 0);
  return [{ account: SUPPLIER_DEBTS, amount: net + vat }, ...costs.map((c) => ({ account: c.account, amount: -c.amount })), ...(vat ? [{ account: VAT_IN, amount: -vat }] : [])];
}
/** Återbetalning från leverantören av en kredit som inte kvittas */
export const refundLines = (amount: number, bank = 1930) => [{ account: bank, amount }, { account: SUPPLIER_DEBTS, amount: -amount }];
/** Hur mycket som kvittas mot en öppen faktura: högst det som återstår på fakturan och på krediten */
export const applicable = (creditLeft: number, invoiceLeft: number) => Math.max(0, Math.min(creditLeft, invoiceLeft));
