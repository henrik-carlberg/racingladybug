// Betalningsprognos per kund utifrån hur kunden har betalat tidigare (ren logik)

const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400_000);
const plus = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10);

export interface Behavior { count: number; avgDelay: number; onTimeShare: number }

/** Snittförsening (dagar efter förfallodagen, tidig betalning räknas som 0) för de senaste betalda fakturorna */
export function behavior(paid: { due: string; paid: string }[], last = 12): Behavior | null {
  const xs = paid.slice(-last);
  if (xs.length < 2) return null;
  const delays = xs.map((x) => Math.max(0, days(x.due, x.paid)));
  return { count: xs.length, avgDelay: Math.round(delays.reduce((s, d) => s + d, 0) / xs.length), onTimeShare: delays.filter((d) => d <= 2).length / xs.length };
}

export interface Prediction { expected: string; late: boolean; delay: number }
/** Väntat betaldatum för en obetald faktura. "Sen" om kunden brukar betala mer än fem dagar efter förfallodagen. */
export function predict(due: string, b: Behavior | null): Prediction | null {
  if (!b) return null;
  return { expected: plus(due, b.avgDelay), late: b.avgDelay > 5, delay: b.avgDelay };
}
