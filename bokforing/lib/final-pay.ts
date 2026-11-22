// Slutlön när en anställning upphör (ren logik). Belopp i öre.
import type { PayItem } from './payroll';

/** En dags lön för månadsavlönade (4,6 % av månadslönen) och semestertillägg enligt semesterlagen (0,43 % per dag) */
export const DAY_PAY = 0.046;
export const SUPPLEMENT = 0.0043;
export const daysInMonth = (d: string) => new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).getUTCDate();

/** Intjänade betalda semesterdagar under innevarande intjänandeår (kalenderår) fram till slutdagen */
export function earnedDays(o: { end: string; start: string | null; perYear: number }) {
  const y = o.end.slice(0, 4);
  const from = o.start && o.start > `${y}-01-01` ? o.start : `${y}-01-01`;
  const days = (Date.parse(o.end) - Date.parse(from)) / 864e5 + 1;
  const inYear = (Date.parse(`${y}-12-31`) - Date.parse(`${y}-01-01`)) / 864e5 + 1;
  return Math.max(0, Math.round(((o.perYear * days) / inYear) * 10) / 10);
}

export interface FinalPayInput {
  monthly: number; end: string; unusedDays: number; savedDays: number; earnedDays: number; advanceDays: number;
  rule: 'same' | 'percent'; earnedPay?: number; ownResignation: boolean;
}
/**
 * Slutlönen: månadslön för dagarna fram till slutdagen, semesterersättning för outtagna, sparade och intjänade dagar
 * och avdrag för förskottssemester (tagen men inte intjänad). Förskottssemester dras inte av vid uppsägning från arbetsgivaren.
 */
export function finalPay(o: FinalPayInput) {
  const dim = daysInMonth(o.end), day = Number(o.end.slice(8, 10));
  const salary = day >= dim ? o.monthly : Math.round((o.monthly * day) / dim);
  const days = o.unusedDays + o.savedDays + o.earnedDays;
  const perDay = o.rule === 'percent' && o.earnedPay ? Math.round((0.12 * o.earnedPay) / 25) : Math.round(o.monthly * (DAY_PAY + SUPPLEMENT));
  const vacation = Math.round(perDay * days);
  const advance = o.ownResignation ? Math.round(o.monthly * DAY_PAY * o.advanceDays) : 0;
  const items: PayItem[] = [
    { type: 'salary', description: `Lön ${o.end.slice(0, 7)}${salary !== o.monthly ? ` (${day} av ${dim} dagar)` : ''}`, amount: salary, code: 'final' },
    ...(vacation ? [{ type: 'salary' as const, description: `Semesterersättning ${Math.round(days * 10) / 10} dagar`, amount: vacation, code: 'final' as const }] : []),
    ...(advance ? [{ type: 'salary' as const, description: `Avdrag förskottssemester ${o.advanceDays} dagar`, amount: -advance, code: 'final' as const }] : []),
  ];
  return { salary, vacation, perDay, days, advance, items, gross: salary + vacation - advance };
}
