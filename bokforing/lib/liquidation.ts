// Skifte vid likvidation (ren logik). Belopp i öre, debet positivt.
const isCash = (n: number) => n >= 1900 && n < 2000;
const isEquity = (n: number) => n >= 2000 && n < 2100;
const isPL = (n: number) => n >= 3000;

/** Verifikation för skiftet: eget kapital och årets resultat mot likvida medel. Allt annat ska vara realiserat och betalt. */
export function distributionLines(balances: Map<number, number>) {
  const blocking = [...balances].filter(([n, v]) => v && !isCash(n) && !isEquity(n) && !isPL(n)).map(([n]) => n).sort((a, b) => a - b);
  if (blocking.length) throw new Error(`Tillgångarna ska vara sålda och skulderna betalda före skiftet (konto ${blocking.slice(0, 5).join(', ')})`);
  const out = new Map<number, number>();
  let pl = 0, cash = 0;
  for (const [n, v] of balances) {
    if (!v) continue;
    if (isCash(n)) { out.set(n, (out.get(n) ?? 0) - v); cash += v; }
    else if (isEquity(n)) out.set(n, (out.get(n) ?? 0) - v);
    else pl += v;
  }
  if (pl) out.set(2099, (out.get(2099) ?? 0) - pl);
  if (cash <= 0) throw new Error('Det finns inga likvida medel att skifta');
  return { net: cash, lines: [...out].filter(([, a]) => a).map(([account, amount]) => ({ account, amount })) };
}

/** Kapitalvinst eller -förlust per ägare: skifteslikvid minus omkostnadsbelopp */
export const gains = (rows: { name: string; amount: number; costBasis: number }[]) => rows.map((r) => ({ ...r, gain: r.amount - r.costBasis }));
