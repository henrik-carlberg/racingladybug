// Presentkort: enfunktionsvoucher (momsen känd vid försäljningen) och flerfunktionsvoucher (moms vid inlösen) – ren logik. Belopp i öre inkl. moms.
export type VoucherKind = 'single' | 'multi';
export const LIABILITY = 2421, EXPIRED = 3990;
export const SALES: Record<number, number> = { 25: 3001, 12: 3002, 6: 3003 };
export const VAT_OUT: Record<number, number> = { 25: 2611, 12: 2621, 6: 2631 };
export const vatOf = (gross: number, rate: number) => Math.round((gross * rate) / (100 + rate));

/** Försäljning: enfunktion – moms nu och skulden netto; flerfunktion – hela beloppet som skuld */
export function saleLines(o: { kind: VoucherKind; amount: number; rate: number; payAccount: number }) {
  if (o.kind === 'multi') return [{ account: o.payAccount, amount: o.amount }, { account: LIABILITY, amount: -o.amount }];
  const vat = vatOf(o.amount, o.rate);
  return [{ account: o.payAccount, amount: o.amount }, { account: LIABILITY, amount: -(o.amount - vat) }, { account: VAT_OUT[o.rate], amount: -vat }];
}

/** Inlösen av en del av kortets värde: skulden minskar och blir försäljning (flerfunktion: med moms nu) */
export function redeemLines(o: { kind: VoucherKind; amount: number; rate: number; face: number }) {
  if (o.kind === 'multi') {
    const vat = vatOf(o.amount, o.rate);
    return [{ account: LIABILITY, amount: o.amount }, { account: SALES[o.rate], amount: -(o.amount - vat) }, { account: VAT_OUT[o.rate], amount: -vat }];
  }
  const net = o.amount - vatOf(o.amount, o.rate);
  return [{ account: LIABILITY, amount: net }, { account: SALES[o.rate], amount: -net }];
}

/** Utgånget kort: återstående skuld intäktsförs (ingen moms – för enfunktion är den redan redovisad, för flerfunktion sker ingen leverans) */
export function expireLines(o: { kind: VoucherKind; balance: number; rate: number }) {
  const amount = o.kind === 'multi' ? o.balance : o.balance - vatOf(o.balance, o.rate);
  return amount ? [{ account: LIABILITY, amount }, { account: EXPIRED, amount: -amount }] : [];
}
