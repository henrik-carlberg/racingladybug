// Utlägg för kunds räkning (ren logik). Belopp i öre.
/** Fordran på kunden för betalda utlägg; krediteras när utlägget faktureras utan moms */
export const OUTLAY_ACCOUNT = 1680;

/**
 * Äkta utlägg: köpet är gjort i kundens namn och för kundens räkning (t.ex. en avgift till en myndighet) och kvittot är ställt till kunden.
 * Då är det inte omsättning: ingen moms och utanför momsdeklarationen. Annars är det vidarefakturering – vanlig försäljning med moms.
 */
export function outlayError(o: { receiptInCustomerName: boolean; onBehalf: boolean }) {
  if (!o.receiptInCustomerName || !o.onBehalf) return 'Det är inte ett utlägg för kundens räkning om kvittot inte är ställt till kunden och köpet gjorts för kundens räkning – fakturera i stället kostnaden som vanlig försäljning med moms (vidarefakturering)';
  return null;
}
export const paidLines = (amount: number, bank = 1930) => [{ account: OUTLAY_ACCOUNT, amount }, { account: bank, amount: -amount }];
export const invoiceLine = (o: { description: string; amount: number }) => ({ description: `Utlägg: ${o.description}`, quantity: 1, unit: 'st', unit_price: o.amount, vat_rate: 0, account: OUTLAY_ACCOUNT });
