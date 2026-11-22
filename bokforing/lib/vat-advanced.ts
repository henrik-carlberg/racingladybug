// Moms på djupet (ren logik): proportionering av gemensam ingående moms, jämkning av investeringsvaror och momsregistreringsnummer. Belopp i öre.
export const VAT_IN = 2641;

/**
 * Avdragsandel i blandad verksamhet: momspliktig omsättning (inkl. export och EU-försäljning) av total omsättning,
 * avrundad uppåt till hela procent (Skatteverkets praxis). momsfri = omsättning utan avdragsrätt (t.ex. 3004).
 */
export function deductionShare(taxable: number, exempt: number) {
  const total = Math.max(0, taxable) + Math.max(0, exempt);
  if (total <= 0) return 100;
  return Math.min(100, Math.ceil((Math.max(0, taxable) / total) * 100 - 1e-9));
}

export interface ProportionVoucher { vat: number; costs: { account: number; amount: number }[] }
/**
 * Ingående moms på gemensamma kostnader: momsen på varje verifikation fördelas efter kostnadernas andel som är gemensamma,
 * och den del som inte motsvarar avdragsandelen förs från 2641 till kostnaden.
 */
export function proportionLines(vouchers: ProportionVoucher[], commonAccounts: number[], pct: number) {
  const common = new Set(commonAccounts);
  const perAccount = new Map<number, number>();
  let commonVat = 0;
  for (const v of vouchers) {
    const total = v.costs.reduce((s, c) => s + c.amount, 0);
    if (!(total > 0) || !(v.vat > 0)) continue;
    for (const c of v.costs) if (common.has(c.account) && c.amount > 0) {
      const share = (v.vat * c.amount) / total;
      commonVat += share;
      perAccount.set(c.account, (perAccount.get(c.account) ?? 0) + share * (1 - pct / 100));
    }
  }
  const lines = [...perAccount.entries()].map(([account, a]) => ({ account, amount: Math.round(a) })).filter((l) => l.amount > 0);
  const nonDeductible = lines.reduce((s, l) => s + l.amount, 0);
  if (nonDeductible) lines.push({ account: VAT_IN, amount: -nonDeductible });
  return { lines, commonVat: Math.round(commonVat), nonDeductible };
}

export type InvestmentKind = 'fastighet' | 'nybyggnad' | 'inventarie';
/** Korrigeringstid: förvärv av fastighet 10 år, ny-, till- eller ombyggnad 20 år, maskiner och inventarier 5 år */
export const CORRECTION_YEARS: Record<InvestmentKind, number> = { fastighet: 10, nybyggnad: 20, inventarie: 5 };
export const KIND_LABEL: Record<InvestmentKind, string> = { fastighet: 'Fastighet, förvärv (10 år)', nybyggnad: 'Ny-, till- eller ombyggnad (20 år)', inventarie: 'Maskin/inventarie (5 år)' };
/** Gränser för investeringsvaror: fastighetsinvestering med ingående moms minst 100 000 kr; inventarier med ingående moms motsvarande minst 50 000 kr exkl. moms (25 %) */
export const MIN_VAT: Record<InvestmentKind, number> = { fastighet: 10000000, nybyggnad: 10000000, inventarie: 1250000 };

/**
 * Avyttring under korrigeringstiden: jämkning på en gång för återstående år från och med avyttringsåret.
 * Momspliktig försäljning (eller frivillig skattskyldighet) räknas som 100 % användning, momsfri försäljning eller uttag som 0 %.
 */
export function disposalAdjustment(o: { vat: number; kind: InvestmentKind; completedYear: number; origPct: number }, year: number, taxable: boolean) {
  const years = CORRECTION_YEARS[o.kind];
  const remaining = o.completedYear + years - year;
  if (year < o.completedYear || remaining <= 0) return { amount: 0, remaining: 0 };
  return { amount: Math.round(((o.vat / years) * remaining * ((taxable ? 100 : 0) - o.origPct)) / 100), remaining };
}
/**
 * Jämkning (ML 2023:200 kap. 12): ändras användningen för momspliktig verksamhet under korrigeringstiden ska avdraget jämkas
 * med en tiondel (fastighet) respektive en femtedel (inventarie) av momsen per år, i proportion till ändringen.
 * Jämkning görs bara när ändringen är minst 10 procentenheter. Positivt = ytterligare avdrag, negativt = återbetalning.
 */
export function adjustment(o: { vat: number; kind: InvestmentKind; completedYear: number; origPct: number }, year: number, newPct: number) {
  const years = CORRECTION_YEARS[o.kind];
  const within = year >= o.completedYear && year < o.completedYear + years;
  const change = newPct - o.origPct;
  if (!within) return { amount: 0, reason: 'Utanför korrigeringstiden' };
  if (Math.abs(change) < 10) return { amount: 0, reason: 'Ändringen är mindre än 10 procentenheter' };
  return { amount: Math.round(((o.vat / years) * change) / 100), reason: `${change > 0 ? 'Ökad' : 'Minskad'} momspliktig användning med ${Math.abs(change)} procentenheter` };
}
export function adjustmentLines(amount: number) {
  return amount > 0
    ? [{ account: VAT_IN, amount }, { account: 3999, amount: -amount }]
    : [{ account: 7999, amount: -amount }, { account: VAT_IN, amount }];
}

const EU = new Set(['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'XI']);
/** Momsregistreringsnummer: landskod och nummer (GR heter EL i VIES) */
export function parseVatNumber(raw: string) {
  const s = raw.replace(/[\s.-]/g, '').toUpperCase();
  const m = /^([A-Z]{2})([0-9A-Z]{2,13})$/.exec(s);
  if (!m) return null;
  const cc = m[1] === 'GR' ? 'EL' : m[1];
  return EU.has(cc) ? { country: cc, number: m[2], full: cc + m[2] } : null;
}
