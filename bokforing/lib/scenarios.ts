// Scenarioplanering. Belopp i öre; månader 1–12.
export const EMPLOYER_FEE = 0.3142;
export interface Base { revenue: number[]; costs: number[]; openingCash: number }
export interface Item { id?: number; kind: 'price_pct' | 'cost_pct' | 'lost_customer' | 'hire' | 'investment' | 'loan'; label: string; from_month: number; amount: number; pct: number; years: number }
export const KINDS: Record<Item['kind'], string> = { price_pct: 'Prisändring', cost_pct: 'Kostnadsändring', lost_customer: 'Förlorad kund', hire: 'Nyanställning', investment: 'Investering', loan: 'Lån' };

/** En posts påverkan per månad på intäkter, kostnader och kassa (utöver resultatet) */
export function itemEffect(it: Item, base: Base) {
  const rev = Array(12).fill(0), cost = Array(12).fill(0), cash = Array(12).fill(0);
  for (let m = it.from_month - 1; m < 12; m++) {
    switch (it.kind) {
      case 'price_pct': rev[m] += Math.round(base.revenue[m] * it.pct / 100); break;
      case 'cost_pct': cost[m] += Math.round(base.costs[m] * it.pct / 100); break;
      case 'lost_customer': rev[m] -= it.amount; break;
      case 'hire': cost[m] += Math.round(it.amount * (1 + EMPLOYER_FEE)); break;
      case 'investment': cost[m] += it.years > 0 ? Math.round(it.amount / (it.years * 12)) : 0; break;
      case 'loan': {
        const n = m - (it.from_month - 1);
        const amort = it.years > 0 ? Math.round(it.amount / (it.years * 12)) : 0;
        const outstanding = Math.max(0, it.amount - amort * n);
        cost[m] += Math.round(outstanding * it.pct / 100 / 12);
        cash[m] -= amort;
        break;
      }
    }
  }
  const m0 = it.from_month - 1;
  if (it.kind === 'investment') cash[m0] -= it.amount;
  if (it.kind === 'loan') cash[m0] += it.amount;
  // Avskrivningar påverkar inte kassan
  if (it.kind === 'investment') for (let m = m0; m < 12; m++) cash[m] += it.years > 0 ? Math.round(it.amount / (it.years * 12)) : 0;
  return { rev, cost, cash };
}

/** Resultat och kassa per månad för basen med valda poster */
export function project(base: Base, items: Item[]) {
  const months = Array.from({ length: 12 }, (_, m) => ({ month: m + 1, revenue: base.revenue[m], costs: base.costs[m], extraCash: 0 }));
  for (const it of items) {
    const e = itemEffect(it, base);
    for (let m = 0; m < 12; m++) { months[m].revenue += e.rev[m]; months[m].costs += e.cost[m]; months[m].extraCash += e.cash[m]; }
  }
  let cash = base.openingCash;
  const rows = months.map((x) => { const result = x.revenue - x.costs; cash += result + x.extraCash; return { ...x, result, cash }; });
  const lowest = rows.reduce((a, b) => (b.cash < a.cash ? b : a), rows[0]);
  return { rows, result: rows.reduce((s, r) => s + r.result, 0), lowestCash: lowest.cash, lowestMonth: lowest.month, closingCash: rows[11].cash };
}

/** Varje posts egen påverkan på årets resultat och lägsta kassa, störst först */
export function impacts(base: Base, items: Item[]) {
  const b = project(base, []);
  return items.map((it) => { const p = project(base, [it]); return { label: it.label, kind: it.kind, result: p.result - b.result, lowestCash: p.lowestCash - b.lowestCash }; })
    .sort((a, b) => Math.abs(b.result) - Math.abs(a.result));
}
