// Anläggningstillgångar och avskrivning enligt plan (linjärt per månad) – ren logik (testbar)

export const ASSET_CATEGORIES = {
  datorer: { label: 'Datorer', asset: 1250, accDep: 1259, dep: 7835, life: 36, names: ['Datorer', 'Ackumulerade avskrivningar på datorer', 'Avskrivningar på datorer'] },
  inventarier: { label: 'Inventarier och verktyg', asset: 1220, accDep: 1229, dep: 7832, life: 60, names: ['Inventarier och verktyg', 'Ackumulerade avskrivningar på inventarier och verktyg', 'Avskrivningar på inventarier och verktyg'] },
  maskiner: { label: 'Maskiner och tekniska anläggningar', asset: 1210, accDep: 1219, dep: 7831, life: 60, names: ['Maskiner och andra tekniska anläggningar', 'Ackumulerade avskrivningar på maskiner och andra tekniska anläggningar', 'Avskrivningar på maskiner och andra tekniska anläggningar'] },
  bilar: { label: 'Bilar och transportmedel', asset: 1240, accDep: 1249, dep: 7834, life: 60, names: ['Bilar och andra transportmedel', 'Ackumulerade avskrivningar på bilar och andra transportmedel', 'Avskrivningar på bilar och andra transportmedel'] },
  byggnader: { label: 'Byggnader', asset: 1110, accDep: 1119, dep: 7820, life: 600, names: ['Byggnader', 'Ackumulerade avskrivningar på byggnader', 'Avskrivningar på byggnader och markanläggningar'] },
  immateriella: { label: 'Immateriella tillgångar', asset: 1010, accDep: 1019, dep: 7810, life: 60, names: ['Balanserade utgifter för utvecklingsarbeten och liknande arbeten', 'Ackumulerade avskrivningar på balanserade utgifter', 'Avskrivningar på immateriella anläggningstillgångar'] },
  goodwill: { label: 'Goodwill', asset: 1070, accDep: 1079, dep: 7817, life: 60, names: ['Goodwill', 'Ackumulerade avskrivningar på goodwill', 'Avskrivningar på goodwill'] },
} as const;
export type AssetCategory = keyof typeof ASSET_CATEGORIES;

/** Vinst/förlust vid avyttring av inventarier och maskiner */
export const DISPOSAL_ACCOUNTS = { gain: 3973, loss: 7973 } as const;

export const periodOf = (d: string) => d.slice(0, 7);
export function addMonths(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
export const monthsBetween = (a: string, b: string) => { const [ya, ma] = a.split('-').map(Number); const [yb, mb] = b.split('-').map(Number); return (yb - ya) * 12 + (mb - ma); };
export const lastDay = (period: string) => { const [y, m] = period.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

/** Avskrivning för månad nr i (0-baserad) enligt plan: lika delar, sista månaden tar resten så att summan blir exakt */
export function monthlyAmount(cost: number, residual: number, life: number, i: number): number {
  const base = cost - residual;
  if (i < 0 || i >= life || base <= 0) return 0;
  const per = Math.floor(base / life);
  return i === life - 1 ? base - per * (life - 1) : per;
}

/** Ackumulerad avskrivning till och med en period */
export function accumulated(a: { cost: number; residual: number; lifeMonths: number; depStart: string }, upToPeriod: string): number {
  const n = Math.min(a.lifeMonths, monthsBetween(periodOf(a.depStart), upToPeriod) + 1);
  let s = 0;
  for (let i = 0; i < n; i++) s += monthlyAmount(a.cost, a.residual, a.lifeMonths, i);
  return s;
}

/** Perioder som ska skrivas av från första månaden till och med upTo, utom de som redan är bokförda */
export function duePeriods(a: { cost: number; residual: number; lifeMonths: number; depStart: string }, upToPeriod: string, booked: Set<string>): { period: string; amount: number }[] {
  const out: { period: string; amount: number }[] = [];
  const start = periodOf(a.depStart);
  const n = Math.min(a.lifeMonths, monthsBetween(start, upToPeriod) + 1);
  for (let i = 0; i < n; i++) {
    const p = addMonths(start, i);
    if (booked.has(p)) continue;
    const amt = monthlyAmount(a.cost, a.residual, a.lifeMonths, i);
    if (amt) out.push({ period: p, amount: amt });
  }
  return out;
}
