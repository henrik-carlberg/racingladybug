// Återkommande leverantörsfakturor: mallar och bevakning per månad (ren logik). Belopp i öre.
export const TOLERANCE = 5; // procent
export type Status = 'received' | 'deviation' | 'missing' | 'upcoming';

/** Månadens läge för en mall: mottagen, avvikande belopp, saknas (förfallodag + 5 dagar passerad) eller kommande */
export function status(o: { expected: number; actual: number | null; dueDay: number; period: string; today: string }): Status {
  if (o.actual != null) return Math.abs(o.actual - o.expected) > (o.expected * TOLERANCE) / 100 ? 'deviation' : 'received';
  const due = `${o.period}-${String(Math.min(o.dueDay, 28)).padStart(2, '0')}`;
  const late = new Date(Date.parse(due) + 5 * 864e5).toISOString().slice(0, 10);
  return o.today > late ? 'missing' : 'upcoming';
}
export const STATUS_LABEL: Record<Status, string> = { received: 'Mottagen', deviation: 'Avvikande belopp', missing: 'Saknas', upcoming: 'Väntas' };

export const periodsBetween = (from: string, to: string) => {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
};
