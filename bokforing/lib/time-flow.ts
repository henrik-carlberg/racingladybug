// Tid till lön och faktura (ren logik): klassning av arbetstid i OB-perioder, övertid och restid. Minuter som heltal.
import type { Hours } from './payroll-agreements';

/** Påskdagen (gregoriansk, Meeus/Jones/Butcher) */
export function easter(year: number) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const plus = (d: Date, n: number) => new Date(d.getTime() + n * 864e5);

/** Storhelger som de flesta kollektivavtal räknar som storhelg-OB: påsk, midsommar, jul och nyår (hela dygnet) */
export function storhelger(year: number) {
  const e = easter(year);
  const jun19 = new Date(Date.UTC(year, 5, 19));
  const midsummerEve = plus(jun19, (5 - jun19.getUTCDay() + 7) % 7); // fredag 19–25 juni
  return new Set([
    `${year}-01-01`, iso(plus(e, -2)), iso(plus(e, -1)), iso(e), iso(plus(e, 1)),
    iso(midsummerEve), iso(plus(midsummerEve, 1)), `${year}-12-24`, `${year}-12-25`, `${year}-12-26`, `${year}-12-31`,
  ]);
}

const toMin = (t: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t); if (!m) return NaN; const v = Number(m[1]) * 60 + Number(m[2]); return Number(m[1]) <= 24 && Number(m[2]) < 60 ? v : NaN; };
export const minutesBetween = (start: string, end: string) => { const s = toMin(start), e = toMin(end); if (Number.isNaN(s) || Number.isNaN(e)) return NaN; return e > s ? e - s : e + 1440 - s; };

export type Category = 'normal' | 'ob_evening' | 'ob_night' | 'ob_weekend' | 'ob_holiday';
/**
 * Delar ett arbetspass i OB-kategorier. Förenklad modell: storhelg hela dygnet, lördag och söndag helg-OB,
 * vardagar kväll 18–22 och natt 22–06. Passet kan gå över midnatt.
 */
export function classifyShift(dateIso: string, start: string, end: string): Record<Category, number> {
  const out: Record<Category, number> = { normal: 0, ob_evening: 0, ob_night: 0, ob_weekend: 0, ob_holiday: 0 };
  const total = minutesBetween(start, end);
  if (!(total > 0)) return out;
  const s = toMin(start);
  const base = Date.parse(dateIso + 'T00:00:00Z');
  const holidays = new Map<number, Set<string>>();
  for (let i = 0; i < total; i++) {
    const abs = s + i;
    const d = new Date(base + Math.floor(abs / 1440) * 864e5);
    const minOfDay = abs % 1440;
    const y = d.getUTCFullYear();
    if (!holidays.has(y)) holidays.set(y, storhelger(y));
    const day = iso(d), wd = d.getUTCDay();
    const cat: Category = holidays.get(y)!.has(day) ? 'ob_holiday' : wd === 0 || wd === 6 ? 'ob_weekend'
      : minOfDay >= 22 * 60 || minOfDay < 6 * 60 ? 'ob_night' : minOfDay >= 18 * 60 ? 'ob_evening' : 'normal';
    out[cat]++;
  }
  return out;
}

export interface FlowEntry { date: string; minutes: number; start_time: string | null; end_time: string | null; kind: 'work' | 'travel' }
/**
 * Timmar till lönespecen: OB per kategori (för pass med klockslag), enkel övertid för arbetstid över ordinarie tid per dag
 * och restid. Avrundat till hundradels timmar.
 */
export function hoursForPayroll(entries: FlowEntry[], dailyMinutes = 480): Hours & { travel?: number; worked: number } {
  const cat: Record<Category, number> = { normal: 0, ob_evening: 0, ob_night: 0, ob_weekend: 0, ob_holiday: 0 };
  const perDay = new Map<string, number>();
  let travel = 0, worked = 0;
  for (const e of entries) {
    if (e.kind === 'travel') { travel += e.minutes; continue; }
    worked += e.minutes;
    perDay.set(e.date, (perDay.get(e.date) ?? 0) + e.minutes);
    if (e.start_time && e.end_time) { const c = classifyShift(e.date, e.start_time, e.end_time); for (const k of Object.keys(c) as Category[]) cat[k] += c[k]; }
  }
  const overtime = [...perDay.values()].reduce((s, m) => s + Math.max(0, m - dailyMinutes), 0);
  const h = (m: number) => Math.round((m / 60) * 100) / 100;
  const out: Hours & { travel?: number; worked: number } = { worked: h(worked) };
  if (cat.ob_evening) out.ob_evening = h(cat.ob_evening);
  if (cat.ob_night) out.ob_night = h(cat.ob_night);
  if (cat.ob_weekend) out.ob_weekend = h(cat.ob_weekend);
  if (cat.ob_holiday) out.ob_holiday = h(cat.ob_holiday);
  if (overtime) out.ot_simple = h(overtime);
  if (travel) out.travel = h(travel);
  return out;
}

/** Lägger till timmar från tidrapporten till de timmar som redan står på lönespecen */
export function mergeHours(a: Record<string, number>, b: Record<string, number | undefined>) {
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) if (k !== 'worked' && v) out[k] = Math.round(((out[k] ?? 0) + v) * 100) / 100;
  return out;
}
