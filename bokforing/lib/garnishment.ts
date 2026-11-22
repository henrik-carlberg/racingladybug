// Löneutmätning (ren logik). Belopp i öre.
export const GARNISHMENT_ACCOUNT = 2750;
/** Månadens avdrag: beslutat belopp, men den anställde behåller alltid förbehållsbeloppet av nettolönen */
export function deduction(o: { netPay: number; monthly: number; reserved: number }) {
  return Math.max(0, Math.min(o.monthly, o.netPay - o.reserved));
}
export const item = (amount: number, caseNo: string) => ({ type: 'net_deduction' as const, description: `Löneutmätning, Kronofogden mål ${caseNo}`, amount, code: 'garnishment' as const });
/** Inbetalning till Kronofogden av innehållna belopp */
export const payLines = (amount: number) => [{ account: GARNISHMENT_ACCOUNT, amount }, { account: 1930, amount: -amount }];
