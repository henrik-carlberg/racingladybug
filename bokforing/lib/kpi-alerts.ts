// Nyckeltalslarm
export const METRICS = {
  solidity: { label: 'Soliditet', unit: '%', default: { comparator: 'below', threshold: 30 } },
  quick: { label: 'Kassalikviditet', unit: '%', default: { comparator: 'below', threshold: 100 } },
  cash: { label: 'Kassa och bank', unit: 'kr', default: { comparator: 'below', threshold: 100000 } },
  dso: { label: 'Kundfordringarnas ålder (DSO)', unit: 'dagar', default: { comparator: 'above', threshold: 45 } },
  gross: { label: 'Bruttomarginal', unit: '%', default: { comparator: 'below', threshold: 30 } },
  operating: { label: 'Rörelsemarginal', unit: '%', default: { comparator: 'below', threshold: 0 } },
  payroll_budget: { label: 'Personalkostnader över budget', unit: '%', default: { comparator: 'above', threshold: 5 } },
} as const;
export type Metric = keyof typeof METRICS;
export const breached = (value: number | null, comparator: 'below' | 'above', threshold: number) => value != null && (comparator === 'below' ? value < threshold : value > threshold);
/** DSO: kundfordringar delat med fakturerad försäljning per dag de senaste 365 dagarna */
export const dso = (receivables: number, sales365: number) => (sales365 > 0 ? Math.round(receivables / (sales365 / 365)) : null);
/** Överskridande av budget i procent (positivt = över budget) */
export const overBudget = (actual: number, budget: number) => (budget > 0 ? Math.round((actual / budget - 1) * 1000) / 10 : null);
export const fmtValue = (m: Metric, v: number | null) => (v == null ? '–' : METRICS[m].unit === 'kr' ? `${Math.round(v).toLocaleString('sv-SE')} kr` : `${v.toLocaleString('sv-SE')} ${METRICS[m].unit}`);
