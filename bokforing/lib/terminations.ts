// Uppsägning och avgångsvederlag. Belopp i öre.
export const SALARY = 7210, FEES = 7510, ACCRUED_SALARY = 2910, ACCRUED_FEES = 2940;

const months = (from: string, to: string) => {
  const [a, b] = [new Date(`${from}T00:00:00Z`), new Date(`${to}T00:00:00Z`)];
  let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
  if (b.getUTCDate() < a.getUTCDate()) m--;
  return Math.max(0, m);
};
/** Uppsägningstid enligt LAS 11 §: arbetstagaren en månad; arbetsgivaren efter sammanlagd anställningstid */
export function noticeMonths(by: 'employer' | 'employee', start: string | null, noticeDate: string) {
  if (by === 'employee') return 1;
  const y = start ? months(start, noticeDate) / 12 : 0;
  return y < 2 ? 1 : y < 4 ? 2 : y < 6 ? 3 : y < 8 ? 4 : y < 10 ? 5 : 6;
}
/** Sista anställningsdagen: uppsägningsdagen plus uppsägningstiden */
export function lastDay(noticeDate: string, m: number) {
  const d = new Date(`${noticeDate}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + m);
  const max = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, max));
  return d.toISOString().slice(0, 10);
}

/** Avgångsvederlag som engångsbelopp: skatteavdrag med angiven procent, arbetsgivaravgift ovanpå */
export function severanceCalc(gross: number, taxPct: number, feeRate: number) {
  const tax = Math.round(gross * taxPct / 100), fee = Math.round(gross * feeRate / 100);
  return { gross, tax, net: gross - tax, fee, cost: gross + fee };
}

/** Skulden att reservera: uppsägningslön för arbetsbefriad tid (lönen betalas utan motprestation) och avgångsvederlaget, med arbetsgivaravgifter */
export function obligation(o: { monthlySalary: number; noticeMonths: number; gardenLeave: boolean; severance: number; feeRate: number }) {
  const salary = (o.gardenLeave ? o.monthlySalary * o.noticeMonths : 0) + o.severance;
  const fee = Math.round(salary * o.feeRate / 100);
  return { salary, fee, total: salary + fee };
}
export const accrualLines = (salary: number, fee: number) => [
  ...(salary ? [{ account: SALARY, amount: salary }, { account: ACCRUED_SALARY, amount: -salary }] : []),
  ...(fee ? [{ account: FEES, amount: fee }, { account: ACCRUED_FEES, amount: -fee }] : []),
];
