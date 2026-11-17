// Resursbokning: beräkningar utan databas. Tider som lokala strängar "YYYY-MM-DD HH:MM" (Europe/Stockholm).

export const KINDS: Record<string, string> = { room: 'Lokal/rum', equipment: 'Utrustning', vehicle: 'Fordon', person: 'Person/konsult', other: 'Annat' };

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const ms = (local: string) => Date.parse(local.replace(' ', 'T') + ':00Z');

/** Två tidsintervall överlappar (slut = start räknas inte som krock) */
export const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart < bEnd && bStart < aEnd;

export const hoursBetween = (start: string, end: string) => Math.round(((ms(end) - ms(start)) / 3600000) * 100) / 100;

/** Antal påbörjade kalenderdagar som bokningen spänner över */
export function daysSpanned(start: string, end: string): number {
  const s = Date.parse(start.slice(0, 10)), e = Date.parse(end.slice(0, 10));
  const extra = end.slice(11) === '00:00' && end.slice(0, 10) > start.slice(0, 10) ? 0 : 1;
  return Math.round((e - s) / 86400000) + extra;
}

/** Pris: timpris × timmar, men högst dagpris × påbörjade dagar när båda finns */
export function bookingPrice(start: string, end: string, priceHour: number, priceDay: number): { amount: number; unit: 'h' | 'dag'; qty: number; unitPrice: number } {
  const h = hoursBetween(start, end), d = daysSpanned(start, end);
  const byHour = priceHour ? Math.round(h * priceHour) : Infinity, byDay = priceDay ? d * priceDay : Infinity;
  if (byHour === Infinity && byDay === Infinity) return { amount: 0, unit: 'h', qty: h, unitPrice: 0 };
  return byDay < byHour ? { amount: byDay, unit: 'dag', qty: d, unitPrice: priceDay } : { amount: byHour, unit: 'h', qty: h, unitPrice: priceHour };
}

/** Ligger bokningen inom öppettiden (samma dag)? Bokningar över flera dagar kontrolleras inte. */
export function withinOpenHours(start: string, end: string, openFrom: string, openTo: string): boolean {
  if (start.slice(0, 10) !== end.slice(0, 10)) return true;
  return toMin(start.slice(11)) >= toMin(openFrom) && toMin(end.slice(11)) <= toMin(openTo);
}

/** Datum för en bokning som upprepas varje vecka */
export function weekly(date: string, times: number): string[] {
  return [...Array(Math.max(1, times))].map((_, i) => {
    const d = new Date(date + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + 7 * i);
    return d.toISOString().slice(0, 10);
  });
}

/** Beläggning: bokade timmar av tillgängliga (öppettid × vardagar i perioden) */
export function utilization(bookedHours: number, openFrom: string, openTo: string, workdays: number): number {
  const avail = ((toMin(openTo) - toMin(openFrom)) / 60) * workdays;
  return avail > 0 ? Math.round((bookedHours / avail) * 1000) / 10 : 0;
}

export function workdaysInMonth(period: string): number {
  const y = Number(period.slice(0, 4)), m = Number(period.slice(5, 7));
  let n = 0;
  for (let d = 1; d <= new Date(Date.UTC(y, m, 0)).getUTCDate(); d++) {
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}
