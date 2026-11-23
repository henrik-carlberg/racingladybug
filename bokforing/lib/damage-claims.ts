// Försäkringsskador. Belopp i öre; rader med positivt belopp = debet.
import { DISPOSAL_ACCOUNTS } from '@/lib/assets';
export interface SignedLine { account: number; amount: number }
export const RECEIVABLE = 1689; // Övriga kortfristiga fordringar (beviljad ersättning)
export const COMPENSATION = 3994; // Försäkringsersättningar
export const INVENTORY = 1460, STOCK_CHANGE = 4960;

/** Ersättningen = försäkringsbolagets värdering minus självrisken (aldrig negativ) */
export function compensation(assessed: number, deductible: number) { return Math.max(0, assessed - deductible); }

/** Utrangering av en förstörd anläggningstillgång: anskaffningsvärde och avskrivningar bort, bokfört värde som förlust */
export function scrapLines(cost: number, depreciated: number, o: { asset: number; accDep: number }): SignedLine[] {
  return [{ account: o.asset, amount: -cost }, { account: o.accDep, amount: depreciated }, { account: DISPOSAL_ACCOUNTS.loss, amount: cost - depreciated }].filter((l) => l.amount);
}
/** Förstörda varor skrivs bort ur lagret till genomsnittligt anskaffningsvärde */
export const stockLossLines = (value: number): SignedLine[] => value ? [{ account: STOCK_CHANGE, amount: value }, { account: INVENTORY, amount: -value }] : [];
export const assessmentLines = (amount: number): SignedLine[] => [{ account: RECEIVABLE, amount }, { account: COMPENSATION, amount: -amount }];
export const paymentLines = (amount: number, bank = 1930): SignedLine[] => [{ account: bank, amount }, { account: RECEIVABLE, amount: -amount }];

