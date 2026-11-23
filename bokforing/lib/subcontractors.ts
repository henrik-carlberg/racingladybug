// Underkonsulter. Belopp i öre exkl. moms.
export const markupPct = (cost: number, bill: number) => (cost ? Math.round((bill - cost) / cost * 1000) / 10 : 0);

/** Timmar som underkonsultens faktura motsvarar (fakturabelopp exkl. moms / timpris) */
export const invoicedHours = (net: number, costRate: number) => Math.round(net / costRate * 100) / 100;

export interface Period { hours: number; billed: boolean; supplier_hours: number | null }
/** Marginal och avvikelser för ett uppdrag */
export function assignmentResult(periods: Period[], costRate: number, billRate: number) {
  const hours = periods.reduce((s, p) => s + p.hours, 0);
  const billedHours = periods.filter((p) => p.billed).reduce((s, p) => s + p.hours, 0);
  const supplierHours = periods.reduce((s, p) => s + (p.supplier_hours ?? 0), 0);
  const revenue = Math.round(billedHours * billRate), cost = Math.round(supplierHours * costRate);
  return { hours: r2(hours), billedHours: r2(billedHours), supplierHours: r2(supplierHours), revenue, cost, margin: revenue - cost,
    warning: supplierHours > billedHours + 0.001 ? r2(supplierHours - billedHours) : 0 };
}
const r2 = (n: number) => Math.round(n * 100) / 100;
