// Ränta på skattekontot (skatteförfarandelagen 65 kap.). Belopp i öre, räntesatser i hundradels procent.
export const COST_ACCOUNT = 8423;   // Räntekostnader för skatter och avgifter – inte avdragsgill
export const INCOME_ACCOUNT = 8314; // Skattefria ränteintäkter
export const TAX_ACCOUNT = 1630;
export const DEFAULT_BASE_RATE = 275;

/** Räntesatser utifrån basräntan: kostnadsränta = basränta + 15, låg kostnadsränta (anstånd) = basränta + 1, intäktsränta = basränta − 1,25 (lägst 0) */
export const rates = (base: number) => ({ cost: base + 1500, low: base + 100, income: Math.max(0, base - 125) });

export interface Day { date: string; balance: number; deferred: number }

/**
 * Ränta per dag. `balance` är saldot på 1630 i bokföringen (debet = fordran på Skatteverket). Ett beviljat anstånd
 * tillgodoförs skattekontot hos Skatteverket, så det saldo som räntan räknas på är bokfört saldo plus anståndet.
 * På anståndsbeloppet tas låg kostnadsränta ut. Räntan avrundas till hela kronor.
 */
export function interest(days: Day[], base: number) {
  const r = rates(base);
  let cost = 0, income = 0;
  for (const d of days) {
    const skv = d.balance + d.deferred;
    if (skv < 0) cost += (-skv * r.cost) / 10000 / 365;
    else income += (skv * r.income) / 10000 / 365;
    if (d.deferred > 0) cost += (d.deferred * r.low) / 10000 / 365;
  }
  const kr = (x: number) => Math.round(x / 100) * 100;
  return { cost: kr(cost), income: kr(income), rates: r };
}

/** Konteringen: kostnadsränta debet 8423 / kredit 1630, intäktsränta debet 1630 / kredit 8314 */
export function interestLines(cost: number, income: number) {
  const l: { account: number; amount: number }[] = [];
  if (cost) l.push({ account: COST_ACCOUNT, amount: cost }, { account: TAX_ACCOUNT, amount: -cost });
  if (income) l.push({ account: TAX_ACCOUNT, amount: income }, { account: INCOME_ACCOUNT, amount: -income });
  return l;
}

/** Datumen i en månad (YYYY-MM) */
export function monthDays(period: string) {
  const [y, m] = period.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${period}-${String(i + 1).padStart(2, '0')}`);
}
