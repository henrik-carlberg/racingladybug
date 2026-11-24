// Lagen om anställningsskydd (LAS) i lydelsen från 1 oktober 2022
export const FORMS = { sav: 'Särskild visstidsanställning', vikariat: 'Vikariat', provanstallning: 'Provanställning', tillsvidare: 'Tillsvidare', other: 'Annan visstid' } as const;
export type Form = keyof typeof FORMS;
export type Period = { form: Form; start: string; end: string | null; shortage?: boolean };

const DAY = 864e5;
const addYears = (d: string, y: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCFullYear(x.getUTCFullYear() + y); return x.toISOString().slice(0, 10); };
const addMonths = (d: string, m: number) => { const x = new Date(`${d}T00:00:00Z`); const day = x.getUTCDate(); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + m); const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate(); x.setUTCDate(Math.min(day, last)); return x.toISOString().slice(0, 10); };
/** Anställda dagar (inklusive båda ändarna) inom ett fönster */
export function daysWithin(periods: Period[], from: string, to: string, forms?: Form[]) {
  let total = 0;
  for (const p of periods) {
    if (forms && !forms.includes(p.form)) continue;
    const s = p.start > from ? p.start : from, e = (p.end ?? to) < to ? (p.end ?? to) : to;
    if (e >= s) total += Math.round((Date.parse(e) - Date.parse(s)) / DAY) + 1;
  }
  return total;
}
const YEAR_DAYS = 365;
/**
 * Övergång till tillsvidareanställning (5 a §): särskild visstid i sammanlagt mer än 12 månader, eller vikariat i mer än två år, under en femårsperiod.
 * Räknas på pågående anställning; dagar kvar till gränsen visas.
 */
export function conversion(periods: Period[], today: string) {
  const current = periods.find((p) => p.start <= today && (!p.end || p.end >= today));
  if (!current || (current.form !== 'sav' && current.form !== 'vikariat')) return null;
  const limit = current.form === 'sav' ? YEAR_DAYS : 2 * YEAR_DAYS;
  const used = daysWithin(periods, addYears(today, -5), today, [current.form]);
  const left = limit - used;
  return { form: current.form, used, limit, left, converted: left < 0, warn: left >= 0 && left <= 60, convertsOn: left >= 0 ? new Date(Date.parse(today) + (left + 1) * DAY).toISOString().slice(0, 10) : null };
}
/** Företrädesrätt till återanställning (25 §): arbetsbrist och mer än 12 månader under de senaste tre åren; gäller till nio månader efter anställningens slut */
export function priority(periods: Period[], today: string) {
  const ended = periods.filter((p) => p.end && p.shortage).sort((a, b) => (b.end! > a.end! ? 1 : -1))[0];
  if (!ended) return null;
  const qualifying = daysWithin(periods, addYears(ended.end!, -3), ended.end!) > YEAR_DAYS;
  const until = addMonths(ended.end!, 9);
  return { qualifying, endedOn: ended.end!, until, active: qualifying && today <= until };
}
/** Sammanlagd anställningstid hos arbetsgivaren i dagar (turordning, 22 §) */
export const totalDays = (periods: Period[], today: string) => daysWithin(periods, '1900-01-01', today);
/** Turordning inom en krets: kortast anställningstid sägs upp först, vid lika tid den yngre; upp till tre undantas */
export function seniority<T extends { name: string; days: number; birth: string; exempt: boolean }>(people: T[]) {
  const ordered = [...people].sort((a, b) => b.days - a.days || a.birth.localeCompare(b.birth));
  return ordered.map((p, i) => ({ ...p, rank: i + 1 }));
}
export const MAX_EXEMPT = 3;
