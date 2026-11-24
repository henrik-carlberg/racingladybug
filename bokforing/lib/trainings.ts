// Utbildning och behörigheter. Belopp i öre.
export const TRAINING_COST = 7610;
export const COMMON = ['Truckkort', 'Heta arbeten', 'ID06', 'HLR och första hjälpen', 'Arbete på väg', 'Fallskydd', 'Elsäkerhet', 'Ställningsbyggnad', 'Brandskydd', 'Arbetsmiljö (BAM)'];

const addMonths = (d: string, m: number) => { const x = new Date(`${d}T00:00:00Z`); const day = x.getUTCDate(); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + m); const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate(); x.setUTCDate(Math.min(day, last)); return x.toISOString().slice(0, 10); };
export const validUntil = (completed: string, months: number | null) => (months ? addMonths(completed, months) : null);

/** Giltighet: utgånget, går ut inom 60 dagar, giltigt eller utan slutdatum */
export function validity(until: string | null, today: string, warnDays = 60) {
  if (!until) return { status: 'permanent' as const, days: null };
  const days = Math.round((Date.parse(until) - Date.parse(today)) / 864e5);
  return { status: days < 0 ? 'expired' as const : days <= warnDays ? 'expiring' as const : 'valid' as const, days };
}
/**
 * Utbildning som arbetsgivaren betalar är skattefri när den behövs i arbetet. Annan utbildning är en skattepliktig förmån,
 * utom omställningsutbildning vid uppsägning (IL 11 kap. 32 §).
 */
export const taxableBenefit = (workRelated: boolean, cost: number) => (workRelated ? 0 : cost);
export const costLines = (amount: number, credit = 1930) => (amount ? [{ account: TRAINING_COST, amount }, { account: credit, amount: -amount }] : []);
/** Senaste registreringen per anställd och behörighet räknas (en förnyad behörighet ersätter den gamla) */
export function latest<T extends { employee_id: number; title: string; completed_on: string }>(rows: T[]) {
  const m = new Map<string, T>();
  for (const r of rows) { const k = `${r.employee_id}|${r.title.trim().toLowerCase()}`; const p = m.get(k); if (!p || r.completed_on > p.completed_on) m.set(k, r); }
  return [...m.values()];
}
