// Skogsbruk för enskild näringsidkare: skogskonto, skogsskadekonto och skogsavdrag (ren logik). Belopp i öre.
export type SaleKind = 'rotpost' | 'leveransvirke';
export const KIND_LABEL: Record<SaleKind, string> = { rotpost: 'Rotpost eller avverkningsuppdrag', leveransvirke: 'Leveransvirke' };
/** Högsta insättning i procent av likviden: skogskonto 60/40, skogsskadekonto 80/50 */
export const DEPOSIT_RATE = { skog: { rotpost: 60, leveransvirke: 40 }, skada: { rotpost: 80, leveransvirke: 50 } } as const;
/** Skogsavdrag: högst 50 % av rotpostintäkt och 30 % av leveransvirke, totalt högst 50 % av anskaffningsvärdet för skogen */
export const DEDUCTION_RATE: Record<SaleKind, number> = { rotpost: 50, leveransvirke: 30 };
export const ACCOUNTS = { skog: 1940, skada: 1941, bank: 1930 } as const;
export type ForestAccount = keyof typeof DEPOSIT_RATE;

export interface Sale { kind: SaleKind; amount: number }
/** Högsta insättning på ett konto för årets likvider */
export const maxDeposit = (sales: Sale[], account: ForestAccount) => sales.reduce((s, x) => s + Math.floor((x.amount * DEPOSIT_RATE[account][x.kind]) / 100), 0);
/**
 * Insättningsutrymme för ett beskattningsår. Samma likvid kan bara sättas in en gång: det som har satts in på det ena kontot
 * tar i anspråk motsvarande andel av utrymmet på det andra.
 */
export function depositRoom(sales: Sale[], account: ForestAccount, deposited: { skog: number; skada: number }) {
  const ms = maxDeposit(sales, 'skog'), md = maxDeposit(sales, 'skada');
  if (!ms || !md) return 0;
  const used = deposited.skog / ms + deposited.skada / md;
  return Math.max(0, Math.floor((account === 'skog' ? ms : md) * (1 - used)));
}

/** Skogsavdrag för året: av årets intäkter, högst återstående utrymme av halva anskaffningsvärdet */
export function deductionRoom(sales: Sale[], acquisition: number, usedBefore: number) {
  const ofIncome = sales.reduce((s, x) => s + Math.floor((x.amount * DEDUCTION_RATE[x.kind]) / 100), 0);
  const total = Math.max(0, Math.floor(acquisition / 2) - usedBefore);
  return { ofIncome, total, max: Math.min(ofIncome, total) };
}

export const depositLines = (account: ForestAccount, amount: number, withdraw = false) => {
  const a = withdraw ? -amount : amount;
  return [{ account: ACCOUNTS[account], amount: a }, { account: ACCOUNTS.bank, amount: -a }];
};
