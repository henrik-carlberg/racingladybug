// Återkommande mönster (rena funktioner): saker som händer ungefär samma dag varje månad

const D = (s: string) => new Date(s + 'T00:00:00Z');
const iso = (d: Date) => d.toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((D(b).getTime() - D(a).getTime()) / 86400_000);
export const plusDays = (s: string, n: number) => iso(new Date(D(s).getTime() + n * 86400_000));

/**
 * Månadsmönster: minst tre tillfällen där de tre senaste mellanrummen är 25–38 dagar.
 * Ger den vanliga dagen i månaden (median) och nästa väntade datum.
 */
export function monthlyPattern(dates: string[]): { day: number; last: string; next: string } | null {
  const ds = [...new Set(dates)].sort();
  if (ds.length < 3) return null;
  const recent = ds.slice(-4);
  for (let i = 1; i < recent.length; i++) {
    const g = daysBetween(recent[i - 1], recent[i]);
    if (g < 25 || g > 38) return null;
  }
  const days = recent.map((d) => Number(d.slice(8, 10))).sort((a, b) => a - b);
  const day = days[Math.floor(days.length / 2)];
  const last = ds[ds.length - 1];
  return { day, last, next: nextMonthDay(last, day) };
}

/** Samma dag i månaden efter (sista dagen om månaden är kortare) */
export function nextMonthDay(after: string, day: number): string {
  const d = D(after);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  const len = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(y, m, Math.min(day, len))));
}

/** Normaliserad text för att känna igen "samma" verifikation */
export const normText = (s: string) => s.toLowerCase().replace(/\d{4}-\d{2}(-\d{2})?|\b(jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)[a-zå]*\b|\d+/g, '').replace(/[^\p{L} ]/gu, ' ').replace(/\s+/g, ' ').trim();

export const ordinal = (n: number) => `${n}:${n % 10 === 1 || n % 10 === 2 ? (n % 100 === 11 || n % 100 === 12 ? 'e' : 'a') : 'e'}`;
