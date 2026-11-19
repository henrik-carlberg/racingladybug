// Resultaträkning med jämförelse (ren logik). Belopp i öre; intäkter positiva, kostnader negativa.
export const RESULT_GROUPS: [string, number, number][] = [
  ['Nettoomsättning', 3000, 3799], ['Övriga rörelseintäkter', 3800, 3999],
  ['Varor, material och tjänster', 4000, 4999], ['Övriga externa kostnader', 5000, 6999],
  ['Personalkostnader', 7000, 7699], ['Avskrivningar', 7700, 7899], ['Övriga rörelsekostnader', 7900, 7999],
  ['Finansiella intäkter', 8000, 8399], ['Finansiella kostnader', 8400, 8499],
  ['Bokslutsdispositioner', 8800, 8899], ['Skatter', 8900, 8989],
];
export const BALANCE_GROUPS: [string, number, number][] = [
  ['Anläggningstillgångar', 1000, 1399], ['Varulager', 1400, 1499], ['Kortfristiga fordringar', 1500, 1799], ['Kassa och bank', 1800, 1999],
  ['Eget kapital', 2000, 2099], ['Obeskattade reserver', 2100, 2199], ['Avsättningar', 2200, 2299], ['Långfristiga skulder', 2300, 2399], ['Kortfristiga skulder', 2400, 2999],
];

export interface Row { account: number; name: string; amount: number; compare: number | null }
export interface Group { label: string; total: number; compareTotal: number | null; rows: Row[] }

/** Grupper med konton; sums och compare är debet−kredit per konto (som i bokföringen) */
export function incomeStatement(sums: Map<number, number>, compare: Map<number, number> | null, names: Map<number, string>): { groups: Group[]; result: number; compareResult: number | null } {
  const groups: Group[] = [];
  for (const [label, a, b] of RESULT_GROUPS) {
    const accs = [...new Set([...sums.keys(), ...(compare?.keys() ?? [])])].filter((n) => n >= a && n <= b && ((sums.get(n) ?? 0) !== 0 || (compare?.get(n) ?? 0) !== 0)).sort((x, y) => x - y);
    if (!accs.length) continue;
    const rows = accs.map((n) => ({ account: n, name: names.get(n) ?? '', amount: -(sums.get(n) ?? 0), compare: compare ? -(compare.get(n) ?? 0) : null }));
    groups.push({ label, rows, total: rows.reduce((s, r) => s + r.amount, 0), compareTotal: compare ? rows.reduce((s, r) => s + (r.compare ?? 0), 0) : null });
  }
  const total = (m: Map<number, number>) => -[...m].filter(([n]) => n >= 3000 && n <= 8989).reduce((s, [, v]) => s + v, 0);
  return { groups, result: total(sums), compareResult: compare ? total(compare) : null };
}

/** Budget (positiva belopp för både intäkter och kostnader) → samma tecken som bokföringen (debet−kredit) */
export function budgetAsLedger(budget: Map<number, number>): Map<number, number> {
  return new Map([...budget].map(([a, v]) => [a, (a >= 3000 && a <= 3999) || (a >= 8000 && a <= 8399) ? -v : v]));
}

export const minusYear = (d: string) => { const y = Number(d.slice(0, 4)) - 1; const md = d.slice(5); return md === '02-29' ? `${y}-02-28` : `${y}-${md}`; };
export const pctChange = (cur: number, prev: number | null) => (prev ? Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10 : null);
