// Kommissionsförsäljning. Belopp i öre; rader med positivt belopp = debet.
export const PRINCIPAL_DEBT = 2895; // Skuld till kommittenter
export const COMMISSION_INCOME = 3045; // Provisionsintäkter, kommissionsförsäljning
export const VAT_OUT: Record<number, number> = { 25: 2611, 12: 2621, 6: 2631 };
export const VAT_IN = 2641;

/**
 * En försäljning för huvudmannens räkning. Kommissionären säljer i eget namn och tar ut moms på hela priset;
 * bara provisionen är intäkt och resten är skuld till huvudmannen. Är huvudmannen momsregistrerad lämnar hen moms på sin del, som kommissionären drar av.
 */
export function saleSplit(o: { gross: number; vatRate: number; commissionPct: number; principalVatRegistered: boolean }) {
  const net = Math.round(o.gross / (1 + o.vatRate / 100));
  const vat = o.gross - net;
  const commission = Math.round(net * o.commissionPct / 100);
  const share = net - commission;
  const principalVat = o.principalVatRegistered ? Math.round(share * o.vatRate / 100) : 0;
  return { net, vat, commission, share, principalVat, payable: share + principalVat };
}

export function saleLines(s: ReturnType<typeof saleSplit>, vatRate: number, bank: number) {
  return [
    { account: bank, amount: s.net + s.vat },
    ...(s.vat ? [{ account: VAT_OUT[vatRate], amount: -s.vat }] : []),
    { account: COMMISSION_INCOME, amount: -s.commission },
    { account: PRINCIPAL_DEBT, amount: -s.share },
    ...(s.principalVat ? [{ account: VAT_IN, amount: s.principalVat }, { account: PRINCIPAL_DEBT, amount: -s.principalVat }] : []),
  ].filter((l) => l.amount);
}
export const payoutLines = (amount: number, bank = 1930) => [{ account: PRINCIPAL_DEBT, amount }, { account: bank, amount: -amount }];
