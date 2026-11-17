// Kundreskontra: åldersanalys och dröjsmålsränta utan databas. Belopp i öre.

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

export const BUCKETS = [
  { key: 'current', label: 'Ej förfallet' }, { key: 'd30', label: '1–30 dagar' }, { key: 'd60', label: '31–60 dagar' },
  { key: 'd90', label: '61–90 dagar' }, { key: 'older', label: 'Över 90 dagar' },
] as const;
export type Bucket = (typeof BUCKETS)[number]['key'];

export function bucket(dueDate: string, today: string): Bucket {
  const d = daysBetween(dueDate, today);
  return d <= 0 ? 'current' : d <= 30 ? 'd30' : d <= 60 ? 'd60' : d <= 90 ? 'd90' : 'older';
}

/** Åldersanalys: summa per åldersintervall */
export function aging(items: { due_date: string; amount: number }[], today: string): Record<Bucket, number> & { total: number } {
  const out = { current: 0, d30: 0, d60: 0, d90: 0, older: 0, total: 0 };
  for (const i of items) { out[bucket(i.due_date, today)] += i.amount; out.total += i.amount; }
  return out;
}

/**
 * Dröjsmålsränta enligt räntelagen 6 §: från förfallodagen till betalningsdagen, referensränta + 8 procentenheter,
 * räknat per dag (365 dagar per år). Avrundas till hela kronor.
 */
export function lateInterest(amount: number, dueDate: string, until: string, ratePercent: number): number {
  const days = daysBetween(dueDate, until);
  if (days <= 0 || ratePercent <= 0) return 0;
  return Math.round((amount * (ratePercent / 100) * days) / 365 / 100) * 100;
}

/** Vilken åtgärd som står på tur för en förfallen faktura */
export function nextAction(daysOverdue: number, levels: number[], inCollection: boolean, s: { first_days: number; second_days: number; collection_days: number }):
  'reminder1' | 'reminder2' | 'collection' | null {
  if (inCollection) return null;
  if (!levels.includes(1)) return daysOverdue >= s.first_days ? 'reminder1' : null;
  if (!levels.includes(2)) return daysOverdue >= s.second_days ? 'reminder2' : null;
  return daysOverdue >= s.collection_days ? 'collection' : null;
}
