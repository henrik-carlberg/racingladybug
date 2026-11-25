// Kund- och produktlönsamhet. Belopp i öre.
export type CustomerRow = { revenue: number; goods: number; time: number; losses: number; late: number };
export const contribution = (r: CustomerRow) => r.revenue - r.goods - r.time - r.losses - r.late;
export const marginPct = (r: CustomerRow) => (r.revenue ? Math.round(contribution(r) / r.revenue * 1000) / 10 : null);
/** Räntekostnad för en sen betalning: dagar efter förfallodagen × belopp × ränta / 365 */
export const lateCost = (amount: number, daysLate: number, interestPct: number) => (daysLate > 0 ? Math.round(amount * daysLate * interestPct / 100 / 365) : 0);
/** Simulering: nytt pris i procent och färre dagars försening (bättre betalningsvillkor eller påminnelser) */
export function simulate(r: CustomerRow, pricePct: number, lateReductionPct: number) {
  const next = { ...r, revenue: Math.round(r.revenue * (1 + pricePct / 100)), late: Math.round(r.late * (1 - Math.min(100, Math.max(0, lateReductionPct)) / 100)) };
  return { ...next, contribution: contribution(next), change: contribution(next) - contribution(r) };
}
