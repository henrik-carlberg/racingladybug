// Leverantörsabonnemang (SaaS och licenser). Belopp i öre.
const addMonths = (d: string, m: number) => { const x = new Date(`${d}T00:00:00Z`); const day = x.getUTCDate(); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + m); const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate(); x.setUTCDate(Math.min(day, last)); return x.toISOString().slice(0, 10); };
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

export const monthlyCost = (cost: number, periodMonths: number) => Math.round(cost / periodMonths);
/** Abonnemanget förlängs automatiskt: nästa förnyelse på eller efter dagens datum */
export function nextRenewal(renewal: string, periodMonths: number, today: string) {
  let r = renewal, i = 0;
  while (r < today && i++ < 1000) r = addMonths(renewal, periodMonths * i);
  return r;
}
/** Sista dag att säga upp före nästa förnyelse, och om det är dags (inom 30 dagar) */
export function cancelBy(renewal: string, noticeDays: number, today: string, warnDays = 30) {
  const by = addDays(renewal, -noticeDays);
  const left = Math.round((Date.parse(by) - Date.parse(today)) / 864e5);
  return { by, left, soon: left >= 0 && left <= warnDays, missed: left < 0 };
}
/** Prisändring: senaste fakturan mot avtalat pris per period (mer än 2 % räknas) */
export function priceChange(expected: number, invoiced: number | null) {
  if (invoiced == null || !expected) return null;
  const pct = Math.round((invoiced - expected) / expected * 1000) / 10;
  return Math.abs(pct) > 2 ? pct : null;
}
/** Kostnad för licenser som inte används, per månad */
export const unusedCost = (cost: number, periodMonths: number, seats: number, used: number) => (used >= seats ? 0 : Math.round(monthlyCost(cost, periodMonths) * (seats - used) / seats));
/** Leverantörer som fakturerat i minst tre olika månader det senaste halvåret ser ut som abonnemang */
export const looksRecurring = (months: string[]) => new Set(months).size >= 3;
