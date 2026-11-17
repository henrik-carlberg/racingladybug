// Budget och likviditetsprognos utan databas. Belopp i öre.

export const CATEGORIES = [
  { key: 'revenue', label: 'Intäkter', from: 3000, to: 3999, sign: -1 },
  { key: 'goods', label: 'Varor, material och underentreprenad', from: 4000, to: 4999, sign: 1 },
  { key: 'external', label: 'Övriga externa kostnader', from: 5000, to: 6999, sign: 1 },
  { key: 'personnel', label: 'Personal', from: 7000, to: 7699, sign: 1 },
  { key: 'depreciation', label: 'Avskrivningar', from: 7700, to: 7899, sign: 1 },
  { key: 'financial', label: 'Finansiella poster (netto kostnad)', from: 7900, to: 8799, sign: 1 },
] as const;
export type Category = (typeof CATEGORIES)[number]['key'];

export const categoryOf = (account: number): Category | null => CATEGORIES.find((c) => account >= c.from && account <= c.to)?.key ?? null;

/** Resultat = intäkter − alla kostnader */
export const result = (v: Record<string, number>) => (v.revenue ?? 0) - CATEGORIES.filter((c) => c.key !== 'revenue').reduce((s, c) => s + (v[c.key] ?? 0), 0);

const iso = (d: Date) => d.toISOString().slice(0, 10);
export function addDaysIso(s: string, n: number) { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
export function mondayOf(s: string) { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return iso(d); }

/** Datum för en återkommande post inom [from, to] */
export function occurrences(date: string, recurrence: 'none' | 'monthly' | 'quarterly' | 'yearly', until: string | null, from: string, to: string): string[] {
  const step = { none: 0, monthly: 1, quarterly: 3, yearly: 12 }[recurrence];
  const out: string[] = [];
  const y0 = Number(date.slice(0, 4)), m0 = Number(date.slice(5, 7)) - 1, d0 = Number(date.slice(8, 10));
  for (let i = 0; i < 400; i++) {
    const m = m0 + i * step, y = y0 + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
    const last = new Date(Date.UTC(y, mm + 1, 0)).getUTCDate();
    const d = `${y}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(d0, last)).padStart(2, '0')}`;
    if (d > to || (until && d > until)) break;
    if (d >= from) out.push(d);
    if (!step) break;
  }
  return out;
}

export interface Flow { date: string; amount: number; kind: string; text: string }
export interface Week { start: string; end: string; inflow: number; outflow: number; balance: number; flows: Flow[] }

/** Lägger flöden i veckor från och med `start`. Förfallna poster (före start) hamnar i första veckan. */
export function weekly(opening: number, flows: Flow[], start: string, weeks: number): Week[] {
  const first = mondayOf(start);
  const out: Week[] = [...Array(weeks)].map((_, i) => ({ start: addDaysIso(first, i * 7), end: addDaysIso(first, i * 7 + 6), inflow: 0, outflow: 0, balance: 0, flows: [] }));
  for (const f of flows) {
    const w = f.date < first ? out[0] : out.find((x) => f.date >= x.start && f.date <= x.end);
    if (!w) continue;
    w.flows.push(f);
    if (f.amount >= 0) w.inflow += f.amount; else w.outflow += f.amount;
  }
  let bal = opening;
  for (const w of out) { bal += w.inflow + w.outflow; w.balance = bal; w.flows.sort((a, b) => a.date.localeCompare(b.date)); }
  return out;
}
