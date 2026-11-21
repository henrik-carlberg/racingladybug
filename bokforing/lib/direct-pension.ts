// Direktpension enligt tryggandelagen: pensionsskuld i balansräkningen, särskild löneskatt och kreditförsäkring. Belopp i öre.
import { SLP_RATE } from './payroll-extras';
export interface SignedLine { account: number; amount: number }
export const LIABILITY = 2210, COST = 7420, SLP_COST = 7533, SLP_DEBT = 2514;

/** Årets förändring av pensionsskulden till nytt kapitalvärde, och särskild löneskatt på förändringen (pensionskostnaden) */
export function valuation(previous: number, capitalValue: number) {
  const change = capitalValue - previous;
  const slp = Math.round((change * SLP_RATE) / 100);
  return { change, slp };
}

export function valuationLines(change: number, slp: number): SignedLine[] {
  return [{ account: COST, amount: change }, { account: LIABILITY, amount: -change }, { account: SLP_COST, amount: slp }, { account: SLP_DEBT, amount: -slp }].filter((l) => l.amount);
}

/** Utbetald pension minskar skulden */
export const paymentLines = (amount: number, bank = 1930): SignedLine[] => [{ account: LIABILITY, amount }, { account: bank, amount: -amount }];

/** Avsättningen är skattemässigt avdragsgill bara om pensionsåtagandet är kreditförsäkrat (t.ex. hos PRI) */
export const taxAdjustment = (change: number, insured: boolean) => (insured ? 0 : Math.max(0, change));
