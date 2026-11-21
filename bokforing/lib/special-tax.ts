// Expertskatt (25 % skattefritt, inkomstskattelagen 11 kap. 22 §) och SINK (25 % särskild inkomstskatt för utomlands bosatta). Belopp i öre.
export type SpecialKind = 'expert' | 'sink';
export const EXPERT_EXEMPT = 0.25;
export const SINK_RATE = 25;
export const EXPERT_YEARS = 5;

/** Expertskatt: en fjärdedel av lön och förmåner är skattefri och ingår inte i underlaget för skatt och arbetsgivaravgifter */
export function expertSplit(grossCash: number, benefits: number) {
  const exemptCash = Math.round(grossCash * EXPERT_EXEMPT), exemptBenefits = Math.round(benefits * EXPERT_EXEMPT);
  return { exemptCash, exemptBenefits, taxable: grossCash - exemptCash + benefits - exemptBenefits };
}

/** SINK: 25 % av hela den skattepliktiga ersättningen, i hela kronor */
export const sinkTax = (taxable: number) => Math.floor((taxable * SINK_RATE) / 100 / 100) * 100;

const addYears = (d: string, n: number) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y + n, m - 1, dd - 1)).toISOString().slice(0, 10); };

/** Beslutets giltighet: expertskatt högst fem år, SINK-beslut gäller ett inkomstår */
export function validate(kind: SpecialKind, from: string, to: string) {
  if (to < from) return 'Slutdatumet ligger före startdatumet';
  if (kind === 'expert' && to > addYears(from, EXPERT_YEARS)) return `Expertskatt gäller högst ${EXPERT_YEARS} år (till och med ${addYears(from, EXPERT_YEARS)})`;
  if (kind === 'sink' && to.slice(0, 4) !== from.slice(0, 4)) return 'Ett SINK-beslut gäller ett inkomstår – ansök om nytt beslut för nästa år';
  return null;
}

export const appliesOn = (s: { valid_from: string; valid_to: string } | null | undefined, paymentDate: string) => !!s && paymentDate >= s.valid_from && paymentDate <= s.valid_to;
