// Returemballage och pant. Belopp i öre; rader med positivt belopp = debet.
export const DEPOSIT_LIABILITY = 2899; // Pantskuld för returemballage
export const FORFEIT_INCOME = 3990; // Förverkad pant
export const signedQty = (kind: 'out' | 'return' | 'forfeit', q: number) => (kind === 'out' ? q : -q);

export interface Move { customer: string; type: string; kind: 'out' | 'return' | 'forfeit'; quantity: number; deposit: number; date: string }
/** Saldo per kund och förpackningstyp: utlämnat minus returnerat och förverkat; värdet är panten som ska betalas tillbaka */
export function balances(moves: Move[], today: string, staleDays = 180) {
  const m = new Map<string, { customer: string; type: string; qty: number; value: number; lastOut: string | null; lastReturn: string | null }>();
  for (const x of [...moves].sort((a, b) => a.date.localeCompare(b.date))) {
    const k = `${x.customer}\u0000${x.type}`;
    const b = m.get(k) ?? { customer: x.customer, type: x.type, qty: 0, value: 0, lastOut: null, lastReturn: null };
    b.qty += signedQty(x.kind, x.quantity); b.value += signedQty(x.kind, x.quantity) * x.deposit;
    if (x.kind === 'out') b.lastOut = x.date; else if (x.kind === 'return') b.lastReturn = x.date;
    m.set(k, b);
  }
  const cutoff = new Date(Date.parse(today) - staleDays * 864e5).toISOString().slice(0, 10);
  return [...m.values()].filter((b) => b.qty !== 0).map((b) => ({ ...b, stale: (b.lastReturn ?? b.lastOut ?? today) < cutoff }));
}

/** Pant som kunden inte lämnar tillbaka förverkas: skulden blir intäkt */
export const forfeitLines = (amount: number) => [{ account: DEPOSIT_LIABILITY, amount }, { account: FORFEIT_INCOME, amount: -amount }];
