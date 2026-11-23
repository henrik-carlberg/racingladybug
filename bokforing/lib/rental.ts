// Uthyrning av utrustning. Belopp i öre, perioder i hela dagar (första och sista dagen räknas).
export interface Rates { day: number; week: number | null; month: number | null }

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
export const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);

/** Hyran för ett antal dagar: det billigaste av dagpris, hela veckor och hela månader (30 dagar) – en påbörjad vecka eller månad kostar aldrig mer än en hel */
export function rentFor(days: number, r: Rates): number {
  if (days <= 0) return 0;
  const byWeeks = (n: number) => (r.week ? Math.floor(n / 7) * r.week + Math.min((n % 7) * r.day, r.week) : n * r.day);
  let best = Math.min(days * r.day, byWeeks(days));
  if (r.month) best = Math.min(best, Math.floor(days / 30) * r.month + Math.min(byWeeks(days % 30), r.month));
  return best;
}

/** Perioden att fakturera: från dagen efter senast fakturerat (eller start) till och med fakturadagen eller återlämningen */
export function billingPeriod(o: { start: string; invoicedUntil: string | null; returnedOn: string | null; until: string }) {
  const from = o.invoicedUntil ? addDays(o.invoicedUntil, 1) : o.start;
  const to = o.returnedOn && o.returnedOn < o.until ? o.returnedOn : o.until;
  return to >= from ? { from, to, days: daysBetween(from, to) } : null;
}

/** Beläggning: uthyrda dagar av perioden */
export function utilization(contracts: { start: string; end: string | null }[], from: string, to: string) {
  let used = 0;
  for (const c of contracts) {
    const a = c.start > from ? c.start : from, b = (c.end ?? to) < to ? (c.end ?? to) : to;
    if (b >= a) used += daysBetween(a, b);
  }
  const total = daysBetween(from, to);
  return { used: Math.min(used, total), total, pct: Math.round(Math.min(used, total) / total * 1000) / 10 };
}
