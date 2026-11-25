// Försäljningsprognos 12 månader: avtal, viktad pipeline och övrig försäljning med säsongsmönster. Belopp i öre exkl. moms.
export const ym = (d: string) => d.slice(0, 7);
export function shiftYm(m: string, n: number) { const [y, mm] = m.split('-').map(Number); const t = y * 12 + mm - 1 + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; }
export function nextMonths(fromYm: string, n = 12) {
  const [y, m] = fromYm.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => { const t = y * 12 + (m - 1) + i; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; });
}
/** Säsongsindex per kalendermånad (1–12) från historik; 1 = genomsnittlig månad. Saknas data blir indexet 1. */
export function seasonality(history: Map<string, number>) {
  const by = Array.from({ length: 12 }, () => [] as number[]);
  for (const [k, v] of history) by[Number(k.slice(5, 7)) - 1].push(v);
  const avg = by.map((a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null));
  const known = avg.filter((x): x is number => x != null);
  const mean = known.length ? known.reduce((s, x) => s + x, 0) / known.length : 0;
  return avg.map((a) => (a == null || !mean || known.length < 12 ? 1 : Math.round((a / mean) * 100) / 100));
}
export const weighted = (value: number, probability: number) => Math.round(value * Math.max(0, Math.min(100, probability)) / 100);
export type ForecastMonth = { month: string; contracts: number; pipeline: number; baseline: number; total: number; budget: number | null; diff: number | null };
export function build(o: { months: string[]; contracts: Map<string, number>; pipeline: Map<string, number>; baselineMonthly: number; season: number[]; budget: Map<string, number> }): ForecastMonth[] {
  return o.months.map((m) => {
    const contracts = o.contracts.get(m) ?? 0, pipeline = o.pipeline.get(m) ?? 0;
    const baseline = Math.round(o.baselineMonthly * o.season[Number(m.slice(5, 7)) - 1]);
    const total = contracts + pipeline + baseline, budget = o.budget.has(m) ? o.budget.get(m)! : null;
    return { month: m, contracts, pipeline, baseline, total, budget, diff: budget == null ? null : total - budget };
  });
}
