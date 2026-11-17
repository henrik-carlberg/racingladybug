// Avtal: perioder, uppsägning och nyckeltal utan databas. Datum som "YYYY-MM-DD", belopp i öre.

export const INTERVALS: Record<number, string> = { 1: 'Månadsvis', 3: 'Kvartalsvis', 6: 'Halvårsvis', 12: 'Årsvis' };

/** Lägger till månader; dag 29–31 blir sista dagen i en kortare månad */
export function addMonths(date: string, n: number): string {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7)) - 1 + n, d = Number(date.slice(8, 10));
  const ty = y + Math.floor(m / 12), tm = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
const minusDay = (d: string) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };

export function period(start: string, months: number) {
  return { start, end: minusDay(addMonths(start, months)), next: addMonths(start, months) };
}

/** Datum då en period ska faktureras: förskott vid periodens början, efterskott dagen efter periodens slut */
export const invoiceDate = (start: string, months: number, inAdvance: boolean) => (inAdvance ? start : addMonths(start, months));

/** Sista dag att säga upp avtalet för att det inte ska förlängas (slutdatum minus uppsägningstid) */
export const noticeDeadline = (endDate: string, noticeMonths: number) => addMonths(endDate, -noticeMonths);

/** Månatligt återkommande värde (MRR) för ett avtal med periodpris */
export const mrr = (periodNet: number, intervalMonths: number) => Math.round(periodNet / intervalMonths);

/** Förlänger slutdatum tills det ligger på eller efter datumet */
export function renewUntil(endDate: string, renewalMonths: number, date: string): string {
  let e = endDate;
  while (e < date) e = addMonths(e, renewalMonths);
  return e;
}
