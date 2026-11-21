// Försäkringsersättning vid skada och ersättningsfond (inkomstskattelagen 31 kap.). Belopp i öre; rader med positivt belopp = debet.
export type FundKind = 'inventarier' | 'byggnad';
export interface SignedLine { account: number; amount: number }
export const COMPENSATION = 3994, SCRAP_LOSS = 7970, FUND = 2160, FUND_CHANGE = 8860, OVERDEP = 2150;
export const USE_YEARS = 3;

/** Skadan: tillgångens bokförda värde utrangeras och försäkringsersättningen tas upp som intäkt */
export function damageLines(o: { bookValue: number; assetAccount: number; compensation: number; receivedTo: number }): SignedLine[] {
  return [{ account: o.receivedTo, amount: o.compensation }, { account: COMPENSATION, amount: -o.compensation },
    { account: SCRAP_LOSS, amount: o.bookValue }, { account: o.assetAccount, amount: -o.bookValue }].filter((l) => l.amount);
}

/** Avsättningen får vara högst försäkringsersättningen för den skadade tillgången */
export function maxFund(compensation: number, alreadySet: number) { return Math.max(0, compensation - alreadySet); }

/** Fonden ska tas i anspråk senast tre år efter avsättningsåret, annars återförs den */
export const deadline = (fundYear: number) => `${fundYear + USE_YEARS}-12-31`;

export const fundLines = (amount: number): SignedLine[] => [{ account: FUND_CHANGE, amount }, { account: FUND, amount: -amount }];
/** Ianspråktagande vid återanskaffning: för inventarier blir fonden överavskrivning på den nya tillgången; för byggnader minskar det skattemässiga värdet */
export const useLines = (amount: number, kind: FundKind): SignedLine[] => [{ account: FUND, amount }, { account: kind === 'inventarier' ? OVERDEP : FUND_CHANGE, amount: -amount }];
export const reverseLines = (amount: number): SignedLine[] => [{ account: FUND, amount }, { account: FUND_CHANGE, amount: -amount }];
