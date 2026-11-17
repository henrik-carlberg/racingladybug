// Frånvaro i lönen: sjuklön med karensavdrag, semestertillägg och löneavdrag. Belopp i öre.
// Sjuklönelagen: sjuklön 80 % av lönen dag 1–14, karensavdrag 20 % av en genomsnittlig veckas sjuklön.
// Semesterlagen 16 a § (sammalöneregeln): semestertillägg 0,43 % av månadslönen per semesterdag.
// Kollektivavtal kan ha andra regler – kontrollera mot ert avtal.
import { swedishNonWorkingDays } from './deadlines';

export type AbsenceKind = 'sick' | 'vacation' | 'vab' | 'parental' | 'leave';
export const KIND_LABEL: Record<AbsenceKind, string> = { sick: 'Sjukfrånvaro', vacation: 'Semester', vab: 'Vård av barn (VAB)', parental: 'Föräldraledighet', leave: 'Tjänstledighet' };

const iso = (d: Date) => d.toISOString().slice(0, 10);
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(from + 'T12:00:00Z'); iso(d) <= to; d.setUTCDate(d.getUTCDate() + 1)) out.push(iso(d));
  return out;
}
export function isWorkday(day: string): boolean {
  const wd = new Date(day + 'T12:00:00Z').getUTCDay();
  return wd !== 0 && wd !== 6 && !swedishNonWorkingDays(Number(day.slice(0, 4))).has(day);
}
export const workdays = (from: string, to: string) => eachDay(from, to).filter(isWorkday);

/** Timlön för månadsavlönad: månadslön × 12 / 52 / veckoarbetstid */
export const hourlyRate = (monthly: number, hoursPerWeek: number) => (monthly * 12) / 52 / hoursPerWeek;

export interface PayItemOut { type: 'salary'; description: string; amount: number }
const r = (n: number) => Math.round(n);

/**
 * Sjukperiod: löneavdrag för frånvarande arbetsdagar, sjuklön 80 % för arbetsdagar inom dag 1–14 (kalenderdagar
 * räknat från första sjukdagen) och karensavdrag 20 % av veckosjuklönen (högst den sjuklön som betalas).
 * Vid återinsjuknande inom fem dagar tas inget nytt karensavdrag (sjuklönelagen 14 §).
 */
export function sickItems(o: { from: string; to: string; extent: number; monthly: number; hoursPerWeek: number; noKarens?: boolean }): PayItemOut[] {
  const hourly = hourlyRate(o.monthly, o.hoursPerWeek), dayHours = o.hoursPerWeek / 5, f = o.extent / 100;
  const all = workdays(o.from, o.to);
  const day15 = eachDay(o.from, o.to)[14];
  const paid = all.filter((d) => !day15 || d < day15);
  const deduction = r(all.length * dayHours * hourly * f);
  const sickPay = r(paid.length * dayHours * hourly * f * 0.8);
  const karens = o.noKarens || !paid.length ? 0 : Math.min(sickPay, r(0.2 * 0.8 * ((o.monthly * 12) / 52) * f));
  const label = `${o.from}–${o.to}${o.extent < 100 ? ` (${o.extent} %)` : ''}`;
  return [
    { type: 'salary', description: `Sjukavdrag ${all.length} dagar ${label}`, amount: -deduction },
    ...(sickPay ? [{ type: 'salary' as const, description: `Sjuklön 80 % ${paid.length} dagar`, amount: sickPay }] : []),
    ...(karens ? [{ type: 'salary' as const, description: 'Karensavdrag', amount: -karens }] : []),
  ];
}

/** Semester: lönen löper som vanligt plus semestertillägg 0,43 % per semesterdag */
export function vacationItems(o: { from: string; to: string; monthly: number; extent?: number }): PayItemOut[] {
  const days = workdays(o.from, o.to).length * ((o.extent ?? 100) / 100);
  if (!days) return [];
  return [{ type: 'salary', description: `Semestertillägg ${String(days).replace('.', ',')} dagar ${o.from}–${o.to}`, amount: r(o.monthly * 0.0043 * days) }];
}

/** VAB, föräldraledighet och tjänstledighet: löneavdrag per frånvarande arbetstimme (ersättning från Försäkringskassan) */
export function leaveItems(o: { kind: AbsenceKind; from: string; to: string; extent: number; monthly: number; hoursPerWeek: number }): PayItemOut[] {
  const days = workdays(o.from, o.to).length;
  if (!days) return [];
  const amount = r(days * (o.hoursPerWeek / 5) * hourlyRate(o.monthly, o.hoursPerWeek) * (o.extent / 100));
  return [{ type: 'salary', description: `Löneavdrag ${KIND_LABEL[o.kind].toLowerCase()} ${days} dagar ${o.from}–${o.to}${o.extent < 100 ? ` (${o.extent} %)` : ''}`, amount: -amount }];
}

/** Uttagna semesterdagar (arbetsdagar) under ett kalenderår */
export function vacationDaysTaken(list: { kind: AbsenceKind; from: string; to: string; extent: number }[], year: number): number {
  const ys = `${year}-01-01`, ye = `${year}-12-31`;
  return list.filter((a) => a.kind === 'vacation').reduce((s, a) => s + workdays(a.from < ys ? ys : a.from, a.to > ye ? ye : a.to).length * (a.extent / 100), 0);
}
