export interface Line {
  account: number;
  debit: number;
  credit: number;
  description?: string;
}

/** Bygger debet/kredit-rader från signerade belopp (positivt = debet). Slår ihop per konto. */
export function fromSigned(entries: { account: number; amount: number; description?: string }[]): Line[] {
  const map = new Map<string, { account: number; amount: number; description?: string }>();
  for (const e of entries) {
    if (e.amount === 0) continue;
    const key = `${e.account}|${e.description ?? ''}`;
    const cur = map.get(key);
    if (cur) cur.amount += e.amount;
    else map.set(key, { ...e });
  }
  return [...map.values()]
    .filter((e) => e.amount !== 0)
    .map((e) => ({
      account: e.account,
      debit: e.amount > 0 ? e.amount : 0,
      credit: e.amount < 0 ? -e.amount : 0,
      description: e.description,
    }));
}

export function totals(lines: Line[]) {
  const debit = lines.reduce((s, l) => s + l.debit, 0);
  const credit = lines.reduce((s, l) => s + l.credit, 0);
  return { debit, credit, balanced: debit === credit && debit > 0 };
}

/** Rättelseverifikation: samma rader med debet och kredit omkastade */
export function reverseLines(lines: Line[]): Line[] {
  return lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
}
