// Internkontroll och riskregister
export const KINDS = { attest: 'Attest', reconciliation: 'Avstämning', access_review: 'Behörighetsgenomgång', segregation: 'Dualitet (fyra ögon)', other: 'Övrig kontroll' } as const;
export const FREQUENCIES = { monthly: 'Varje månad', quarterly: 'Varje kvartal', yearly: 'Varje år' } as const;
export type Frequency = keyof typeof FREQUENCIES;

export const riskScore = (l: number, i: number) => { const s = l * i; return { score: s, level: s >= 15 ? 'high' as const : s >= 8 ? 'medium' as const : 'low' as const }; };
/** Riskmatris 5 × 5: antal risker per sannolikhet (rad, 5 överst) och konsekvens (kolumn) */
export function matrix(risks: { likelihood: number; impact: number }[]) {
  const m = Array.from({ length: 5 }, () => Array(5).fill(0) as number[]);
  for (const r of risks) m[5 - r.likelihood][r.impact - 1]++;
  return m;
}
/** Perioden ett datum tillhör: 2026-11, 2026-K4 eller 2026 */
export function periodOf(freq: Frequency, d: string) {
  const y = d.slice(0, 4), m = Number(d.slice(5, 7));
  return freq === 'monthly' ? d.slice(0, 7) : freq === 'quarterly' ? `${y}-K${Math.ceil(m / 3)}` : y;
}
/** Föregående period */
export function previous(freq: Frequency, p: string) {
  if (freq === 'yearly') return String(Number(p) - 1);
  if (freq === 'quarterly') { const [y, q] = [Number(p.slice(0, 4)), Number(p.slice(6))]; return q === 1 ? `${y - 1}-K4` : `${y}-K${q - 1}`; }
  const [y, m] = [Number(p.slice(0, 4)), Number(p.slice(5, 7))];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
/** Kontrollen ska vara utförd för den senast avslutade perioden (från startperioden) */
export function status(freq: Frequency, start: string, performed: string[], today: string) {
  const current = periodOf(freq, today), last = previous(freq, current);
  const due = last >= start;
  return { current, last, missing: due && !performed.includes(last), doneCurrent: performed.includes(current) };
}
