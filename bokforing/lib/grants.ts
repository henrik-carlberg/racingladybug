// Offentliga bidrag till företag (ren logik): intäkten periodiseras mot de kostnader bidraget ska täcka (K2 kap. 6, K3 kap. 24),
// med förutbetalda respektive upplupna bidrag och skuld när återbetalning är sannolik. Belopp i öre.
export const GRANT_REVENUE = 3980;     // Erhållna offentliga bidrag
export const GRANT_PREPAID = 2975;     // Förutbetalda bidrag (utbetalt men ännu inte intäktsfört)
export const GRANT_ACCRUED = 1791;     // Upplupna bidrag (intäktsfört men ännu inte utbetalt)
export const GRANT_REPAYABLE = 2976;   // Bidrag att återbetala

export type RiskLevel = 'none' | 'possible' | 'probable';
export const RISK_LABEL: Record<RiskLevel, string> = { none: 'Ingen känd risk', possible: 'Möjlig (upplyses om i not)', probable: 'Sannolik – skuld bokas' };

/** Bidrag som är intjänat: täckningsgraden av stödberättigande kostnader, högst det beviljade beloppet */
export function earned(costs: number, coveragePct: number, cap: number) {
  return Math.max(0, Math.min(cap, Math.round((Math.max(0, costs) * coveragePct) / 100)));
}

/** Saldon som följer av utbetalt och intäktsfört: förutbetalt (skuld) eller upplupet (fordran) */
export function balances(received: number, recognized: number) {
  return { prepaid: Math.max(0, received - recognized), accrued: Math.max(0, recognized - received) };
}

/**
 * Konteringen när utbetalt och/eller intäktsfört ändras. Förutbetalt används först vid intäktsföring och upplupet
 * regleras först vid utbetalning – raderna följer av saldona före och efter.
 */
export function balanceLines(before: { received: number; recognized: number }, after: { received: number; recognized: number }, bank = 1930) {
  const b = balances(before.received, before.recognized), a = balances(after.received, after.recognized);
  const out: { account: number; amount: number }[] = [];
  const add = (account: number, amount: number) => { if (amount) out.push({ account, amount }); };
  add(bank, after.received - before.received);
  add(GRANT_PREPAID, -(a.prepaid - b.prepaid));
  add(GRANT_ACCRUED, a.accrued - b.accrued);
  add(GRANT_REVENUE, -(after.recognized - before.recognized));
  return out;
}

/** Återbetalning sannolik: intäktsförda belopp förs tillbaka och det utbetalda blir en skuld till bidragsgivaren */
export function repaymentProvision(received: number, recognized: number) {
  const b = balances(received, recognized);
  const out: { account: number; amount: number }[] = [];
  if (recognized) out.push({ account: GRANT_REVENUE, amount: recognized });
  if (b.prepaid) out.push({ account: GRANT_PREPAID, amount: b.prepaid });
  if (b.accrued) out.push({ account: GRANT_ACCRUED, amount: -b.accrued });
  if (received) out.push({ account: GRANT_REPAYABLE, amount: -received });
  return out;
}

/** Rapport till bidragsgivaren: kostnader per konto, intjänat och vad som återstår att rekvirera */
export function grantReport(o: { costsByAccount: { account: number; name: string; amount: number }[]; coveragePct: number; cap: number; received: number; budget: number }) {
  const costs = o.costsByAccount.reduce((s, c) => s + c.amount, 0);
  const e = earned(costs, o.coveragePct, o.cap);
  return { costs, earned: e, toRequest: Math.max(0, e - o.received), budgetUsedPct: o.budget > 0 ? Math.round((costs / o.budget) * 1000) / 10 : null, remainingGrant: Math.max(0, o.cap - e) };
}
