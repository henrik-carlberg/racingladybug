// Budget per kostnadsställe och projekt: utfall, avvikelse och helårsprognos (ren logik). Belopp i öre.
export type Kind = 'cost' | 'revenue';
/** Varning när utfallet hittills överstiger budgeten hittills med mer än så här mycket (procent) */
export const WARN_PCT = 10;

export function followUp(o: { kind: Kind; budget: number[]; actual: number[]; month: number }) {
  const ytdB = o.budget.slice(0, o.month).reduce((s, x) => s + x, 0);
  const ytdA = o.actual.slice(0, o.month).reduce((s, x) => s + x, 0);
  const yearB = o.budget.reduce((s, x) => s + x, 0);
  // Prognos: utfallet hittills plus budgeten för resten av året
  const forecast = ytdA + o.budget.slice(o.month).reduce((s, x) => s + x, 0);
  const diff = ytdA - ytdB;
  const pct = ytdB ? Math.round((diff / ytdB) * 1000) / 10 : 0;
  const bad = o.kind === 'cost' ? diff > 0 : diff < 0;
  return { ytdB, ytdA, yearB, forecast, diff, pct, warn: bad && Math.abs(pct) > WARN_PCT, overYear: o.kind === 'cost' ? forecast > yearB : forecast < yearB };
}
