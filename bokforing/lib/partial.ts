// Delbetalningar – ren logik (testbar)
import type { Line } from './ledger-lines';

/**
 * Kontantmetoden: en delbetalning bokför sin andel av fakturans kontering. Varje konto får
 * avrundat(belopp × betalt efter / total) − avrundat(belopp × betalt före / total), så att summan efter sista betalningen blir exakt.
 * clearing: kontot som betalningen ersätter (1510 kundfordran / 2440 leverantörsskuld) och som byts mot bank.
 */
export function proportionalLines(full: Line[], total: number, paidBefore: number, amount: number, clearing: number, bank: number): Line[] {
  if (amount <= 0 || paidBefore + amount > total) throw new Error('Ogiltigt belopp för delbetalning');
  const after = paidBefore + amount;
  const share = (v: number, paid: number) => Math.round((v * paid) / total);
  const out: { account: number; amount: number; description?: string; costCenterId?: number | null; projectId?: number | null }[] = [];
  let bankAmount = 0;
  for (const l of full) {
    const signed = l.debit - l.credit;
    const part = share(signed, after) - share(signed, paidBefore);
    if (l.account === clearing) { bankAmount += part; continue; }
    if (part) out.push({ account: l.account, amount: part, description: l.description, costCenterId: l.costCenterId, projectId: l.projectId });
  }
  // Avrundning: balansera mot den största raden
  const diff = bankAmount + out.reduce((s, x) => s + x.amount, 0);
  if (diff && out.length) out.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0].amount -= diff;
  return [{ account: bank, debit: bankAmount > 0 ? bankAmount : 0, credit: bankAmount < 0 ? -bankAmount : 0 },
    ...out.filter((x) => x.amount).map((x) => ({ account: x.account, debit: x.amount > 0 ? x.amount : 0, credit: x.amount < 0 ? -x.amount : 0, description: x.description,
      ...(x.costCenterId ? { costCenterId: x.costCenterId } : {}), ...(x.projectId ? { projectId: x.projectId } : {}) }))];
}
