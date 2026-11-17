// Projekt: ekonomi och framdrift utan databas. Belopp i öre, tid i minuter.

export const STATUS: Record<string, [string, string]> = {
  planned: ['Planerat', ''], active: ['Pågår', 'warn'], on_hold: ['Pausat', ''], done: ['Avslutat', 'ok'],
};
export const TASK_STATUS: Record<string, string> = { todo: 'Att göra', doing: 'Pågår', done: 'Klart' };

export interface Economics {
  revenue: number; externalCost: number; internalCost: number; result: number; margin: number | null;
  hoursUsed: number; hoursPct: number | null; revenuePct: number | null; costPct: number | null;
}

/** Resultat = intäkter − externa kostnader − intern tidskostnad (timmar × internt timpris) */
export function economics(m: { revenue: number; externalCost: number; minutes: number; internalRate: number; budgetHours: number; budgetRevenue: number; budgetCost: number }): Economics {
  const internalCost = Math.round((m.minutes / 60) * m.internalRate);
  const result = m.revenue - m.externalCost - internalCost;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
  return {
    revenue: m.revenue, externalCost: m.externalCost, internalCost, result, margin: pct(result, m.revenue),
    hoursUsed: Math.round((m.minutes / 60) * 100) / 100, hoursPct: pct(m.minutes / 60, m.budgetHours),
    revenuePct: pct(m.revenue, m.budgetRevenue), costPct: pct(m.externalCost + internalCost, m.budgetCost + Math.round(m.budgetHours * m.internalRate)),
  };
}

/** Färdiggrad: andel klara uppgifter viktat med uppskattad tid (lika vikt om inga uppskattningar finns) */
export function progress(tasks: { status: string; estimate_minutes: number }[]): number {
  if (!tasks.length) return 0;
  const w = (t: { estimate_minutes: number }) => (tasks.some((x) => x.estimate_minutes > 0) ? t.estimate_minutes : 1);
  const total = tasks.reduce((s, t) => s + w(t), 0);
  return total ? Math.round((tasks.filter((t) => t.status === 'done').reduce((s, t) => s + w(t), 0) / total) * 100) : 0;
}

/** Prognos för totala timmar: använda timmar / färdiggrad (null om inget är klart än) */
export function forecastHours(hoursUsed: number, progressPct: number): number | null {
  return progressPct > 0 ? Math.round((hoursUsed / (progressPct / 100)) * 10) / 10 : null;
}

/** Position (0–100 %) för ett datum på projektets tidslinje */
export function timelinePos(start: string, end: string, d: string): number {
  const s = Date.parse(start), e = Date.parse(end), x = Date.parse(d);
  if (!(e > s)) return 0;
  return Math.max(0, Math.min(100, Math.round(((x - s) / (e - s)) * 1000) / 10));
}
