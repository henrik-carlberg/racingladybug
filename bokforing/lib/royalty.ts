// Licensintäkter och royalty (ren logik). Belopp i öre, satser i procent.
export const ROYALTY_ACCOUNT = 3920;
export const RECEIVABLE = 1680;
export const FOREIGN_TAX = 8910;
/** Svensk bolagsskatt – taket för avräkning av utländsk skatt (förenklat: på bruttointäkten) */
export const CORPORATE_TAX = 20.6;

/** Periodens royalty: avtalad procent av licenstagarens försäljning, lägst den garanterade minimiavgiften */
export const royalty = (sales: number, rate: number, minimum: number) => Math.max(Math.round((sales * rate) / 100), minimum);

/** Bokföring av en royaltyrapport: fordran mot intäkt, svensk moms 25 % om licenstagaren är svensk (export av tjänst annars) */
export function reportLines(amount: number, domestic: boolean) {
  const vat = domestic ? Math.round(amount * 0.25) : 0;
  return { vat, lines: [{ account: RECEIVABLE, amount: amount + vat }, { account: ROYALTY_ACCOUNT, amount: -amount }, ...(vat ? [{ account: 2611, amount: -vat }] : [])] };
}

/** Inbetalning där licenstagaren har dragit utländsk källskatt */
export function paymentLines(total: number, withheld: number, bank = 1930) {
  return [{ account: bank, amount: total - withheld }, ...(withheld ? [{ account: FOREIGN_TAX, amount: withheld }] : []), { account: RECEIVABLE, amount: -total }];
}

/** Avräkning av utländsk skatt: högst den svenska skatten på samma inkomst; mer än avtalssatsen ska återsökas i källstaten */
export function credit(gross: number, withheld: number, treatyRate: number | null) {
  const limit = Math.round((gross * CORPORATE_TAX) / 100);
  const treatyMax = treatyRate == null ? null : Math.round((gross * treatyRate) / 100);
  const excess = treatyMax == null ? 0 : Math.max(0, withheld - treatyMax);
  return { limit, creditable: Math.min(withheld - excess, limit), reclaim: excess };
}
