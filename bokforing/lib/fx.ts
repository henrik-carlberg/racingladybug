// Omvärdering av poster i utländsk valuta vid bokslut – ren logik (testbar).
// Banktillgodohavanden mot 8330, kundfordringar och leverantörsskulder mot 3960 (vinst) / 7960 (förlust).
import { fromSigned, type Line } from './ledger-lines';

export type FxKind = 'bank' | 'receivable' | 'payable';
export interface FxItem { kind: FxKind; label: string; account: number; currency: string; amountCurrency: number; bookedSek: number }
export interface FxRow extends FxItem { rate: number; valued: number; diff: number }
export const FX_ACCOUNTS = { bank: 8330, gain: 3960, loss: 7960 } as const;

/** Värderar posterna till balansdagens kurs. diff > 0 betyder vinst för tillgångar och förlust för skulder. */
export function revalue(items: FxItem[], rates: Record<string, number>): FxRow[] {
  return items.map((i) => {
    const rate = rates[i.currency];
    if (!(rate > 0)) throw new Error(`Ange kurs för ${i.currency}`);
    const valued = Math.round(i.amountCurrency * rate);
    return { ...i, rate, valued, diff: valued - i.bookedSek };
  });
}

/** Kontering: bank mot 8330, kundfordringar och leverantörsskulder mot 3960/7960 */
export function revaluationLines(rows: FxRow[]): Line[] {
  const e: { account: number; amount: number; description?: string }[] = [];
  for (const r of rows) {
    if (!r.diff) continue;
    const d = `${r.label} ${r.currency} ${(r.amountCurrency / 100).toFixed(2)} à ${r.rate}`;
    if (r.kind === 'bank') e.push({ account: r.account, amount: r.diff, description: d }, { account: FX_ACCOUNTS.bank, amount: -r.diff });
    else if (r.kind === 'receivable') e.push({ account: r.account, amount: r.diff, description: d }, { account: r.diff > 0 ? FX_ACCOUNTS.gain : FX_ACCOUNTS.loss, amount: -r.diff });
    else e.push({ account: r.account, amount: -r.diff, description: d }, { account: r.diff > 0 ? FX_ACCOUNTS.loss : FX_ACCOUNTS.gain, amount: r.diff });
  }
  return fromSigned(e);
}

/** Återföring dagen efter (för kund- och leverantörsfakturor, så att kursdifferensen räknas rätt vid betalningen) */
export const reverseLines = (lines: Line[]): Line[] => lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
