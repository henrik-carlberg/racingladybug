// Flextid och tidbank: planerad tid enligt schemat mot stämplad tid i personalliggaren. Ren logik, minuter.

export interface Span { start: string; end: string } // ISO-tider
const day = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
const minutes = (s: Span) => Math.max(0, Math.round((Date.parse(s.end) - Date.parse(s.start)) / 60000));

/** Per dag: planerat (schemat), arbetat (stämplat) och skillnaden. Dagar utan stämpling räknas inte förrän de har passerat. */
export function dailyFlex(shifts: Span[], logs: Span[], untilDay: string) {
  const out = new Map<string, { planned: number; worked: number; diff: number }>();
  const add = (d: string, k: 'planned' | 'worked', m: number) => { const r = out.get(d) ?? { planned: 0, worked: 0, diff: 0 }; r[k] += m; out.set(d, r); };
  for (const s of shifts) if (day(s.start) <= untilDay) add(day(s.start), 'planned', minutes(s));
  for (const l of logs) if (day(l.start) <= untilDay) add(day(l.start), 'worked', minutes(l));
  for (const r of out.values()) r.diff = r.worked - r.planned;
  return [...out.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, r]) => ({ date, ...r }));
}

export const fmtMinutes = (m: number) => `${m < 0 ? '−' : m > 0 ? '+' : ''}${Math.floor(Math.abs(m) / 60)}:${String(Math.abs(m) % 60).padStart(2, '0')}`;

/** Utbetalning av sparad tid: timlön = månadslön / delare (ofta 165 eller avtalets) */
export function payoutAmount(minutesToPay: number, monthly: number, divisor = 165) {
  return Math.round(((minutesToPay / 60) * monthly) / divisor);
}
