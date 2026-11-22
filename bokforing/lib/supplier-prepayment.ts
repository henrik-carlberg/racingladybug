// Förskott till leverantör. Belopp i öre.
export const PREPAYMENT_ACCOUNT = 1480; // Förskott för varor och tjänster
export const BANK_ACCOUNT = 1930;
export const PAYABLES_ACCOUNT = 2440;
/** Betalt förskott: debet 1480, kredit 1930 */
export const prepayLines = (amount: number) => [{ account: PREPAYMENT_ACCOUNT, amount }, { account: BANK_ACCOUNT, amount: -amount }];
/** Avräkning mot slutfakturan: debet 2440, kredit 1480 */
export const settleLines = (amount: number) => [{ account: PAYABLES_ACCOUNT, amount }, { account: PREPAYMENT_ACCOUNT, amount: -amount }];
/** Återbetalt förskott: debet 1930, kredit 1480 */
export const refundLines = (amount: number) => [{ account: BANK_ACCOUNT, amount }, { account: PREPAYMENT_ACCOUNT, amount: -amount }];
