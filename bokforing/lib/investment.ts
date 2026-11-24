// Investeringskalkyl. Belopp i öre, räntor i procent per år.
export type Calc = { investment: number; lifeYears: number; annualIn: number; annualOut: number; growthPct: number; residual: number; ratePct: number };

/** Årliga nettoinbetalningar (år 1..n) med årlig ökning; restvärdet kommer sista året */
export function flows(c: Calc) {
  const out: number[] = [];
  for (let y = 1; y <= c.lifeYears; y++) out.push(Math.round((c.annualIn - c.annualOut) * Math.pow(1 + c.growthPct / 100, y - 1)) + (y === c.lifeYears ? c.residual : 0));
  return out;
}
export const npv = (ratePct: number, investment: number, f: number[]) => Math.round(f.reduce((s, x, i) => s + x / Math.pow(1 + ratePct / 100, i + 1), 0) - investment);
/** Internränta (där nuvärdet blir noll), sökt med intervallhalvering mellan −99 % och 1 000 % */
export function irr(investment: number, f: number[]) {
  let lo = -99, hi = 1000;
  const v = (r: number) => f.reduce((s, x, i) => s + x / Math.pow(1 + r / 100, i + 1), 0) - investment;
  if (v(lo) < 0 || v(hi) > 0) return null;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (v(mid) > 0) lo = mid; else hi = mid; }
  return Math.round(((lo + hi) / 2) * 100) / 100;
}
/** Återbetalningstid i år (utan diskontering), med bråkdel för det år då investeringen är återbetald */
export function payback(investment: number, f: number[]) {
  let left = investment;
  for (let i = 0; i < f.length; i++) { if (f[i] >= left) return Math.round((i + (f[i] > 0 ? left / f[i] : 0)) * 10) / 10; left -= f[i]; }
  return null;
}
/** Annuitet: nuvärdet fördelat som lika stora årliga belopp över livslängden */
export const annuity = (npvValue: number, ratePct: number, years: number) => (ratePct === 0 ? Math.round(npvValue / years) : Math.round(npvValue * (ratePct / 100) / (1 - Math.pow(1 + ratePct / 100, -years))));

export function evaluate(c: Calc) {
  const f = flows(c), n = npv(c.ratePct, c.investment, f);
  const s = (patch: Partial<Calc>) => { const x = { ...c, ...patch }; return npv(x.ratePct, x.investment, flows(x)); };
  return {
    flows: f, npv: n, irr: irr(c.investment, f), payback: payback(c.investment, f), annuity: annuity(n, c.ratePct, c.lifeYears), profitable: n >= 0,
    sensitivity: { revenueMinus20: s({ annualIn: Math.round(c.annualIn * 0.8) }), revenuePlus20: s({ annualIn: Math.round(c.annualIn * 1.2) }), ratePlus2: s({ ratePct: c.ratePct + 2 }), rateMinus2: s({ ratePct: Math.max(0, c.ratePct - 2) }) },
  };
}
/** Finansiering: nuvärdet av utbetalningarna för köp kontant, annuitetslån över livslängden och leasing med månadsavgift */
export function financing(c: Calc, loanRatePct: number | null, leaseMonthly: number | null) {
  const d = (amount: number, year: number) => amount / Math.pow(1 + c.ratePct / 100, year);
  const cash = c.investment - Math.round(d(c.residual, c.lifeYears));
  let loan: number | null = null;
  if (loanRatePct != null) {
    const r = loanRatePct / 100, pay = r === 0 ? c.investment / c.lifeYears : c.investment * r / (1 - Math.pow(1 + r, -c.lifeYears));
    loan = Math.round(Array.from({ length: c.lifeYears }, (_, i) => d(pay, i + 1)).reduce((a, b) => a + b, 0) - d(c.residual, c.lifeYears));
  }
  const lease = leaseMonthly != null ? Math.round(Array.from({ length: c.lifeYears * 12 }, (_, m) => leaseMonthly / Math.pow(1 + c.ratePct / 100, (m + 1) / 12)).reduce((a, b) => a + b, 0)) : null;
  const options = [{ key: 'cash', cost: cash }, ...(loan != null ? [{ key: 'loan', cost: loan }] : []), ...(lease != null ? [{ key: 'lease', cost: lease }] : [])];
  return { cash, loan, lease, best: options.sort((a, b) => a.cost - b.cost)[0].key };
}
