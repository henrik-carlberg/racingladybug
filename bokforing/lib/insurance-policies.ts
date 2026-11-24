// Försäkringsöversikt. Belopp i öre.
export const PREPAID = 1790, INSURANCE_COST = 6310;

const monthIndex = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;
/** Påbörjade månader av försäkringsperioden fram till ett datum */
export function elapsed(start: string, end: string, at: string) {
  const total = Math.max(1, monthIndex(end) - monthIndex(start) + (end.slice(8) >= start.slice(8) ? 1 : 0));
  if (at < start) return { months: 0, total };
  return { months: Math.min(total, monthIndex(at) - monthIndex(start) + 1), total };
}
/** Den del av premien som ska vara kostnadsförd per datumet */
export const dueCost = (premium: number, start: string, end: string, at: string) => { const e = elapsed(start, end, at); return Math.round(premium * e.months / e.total); };

export const reclassLines = (premium: number, from = INSURANCE_COST) => [{ account: PREPAID, amount: premium }, { account: from, amount: -premium }];
export const periodLines = (amount: number) => (amount ? [{ account: INSURANCE_COST, amount }, { account: PREPAID, amount: -amount }] : []);
export const renewalDue = (end: string, today: string, days = 60) => { const d = Math.round((Date.parse(end) - Date.parse(today)) / 864e5); return d >= 0 && d <= days ? d : null; };

export const yearlyCost = (premium: number, start: string, end: string) => Math.round(premium * 12 / elapsed(start, end, start).total);
