// Lönerevision: beräkningar utan databas.

/** Ny lön efter en procentuell höjning, avrundad till hela kronor (öre in, öre ut) */
export function raiseByPercent(current: number, percent: number): number {
  return Math.round((current * (1 + percent / 100)) / 100) * 100;
}

/** Höjning i procent med en decimal */
export const raisePercent = (current: number, next: number) => (current ? Math.round(((next - current) / current) * 1000) / 10 : 0);

export interface ReviewRow { current: number; next: number }
export interface ReviewSummary {
  payroll: number; // nuvarande lönesumma per månad
  budget: number; // utrymme per månad
  allocated: number; // fördelat per månad
  left: number; // kvar av utrymmet
  percent: number; // fördelat i procent av lönesumman
  raised: number; // antal som får höjning
  minPercent: number; maxPercent: number;
}

export function summarize(rows: ReviewRow[], budgetPercent: number): ReviewSummary {
  const payroll = rows.reduce((s, r) => s + r.current, 0);
  const allocated = rows.reduce((s, r) => s + (r.next - r.current), 0);
  const budget = Math.round((payroll * budgetPercent) / 100);
  const pcts = rows.filter((r) => r.current > 0).map((r) => raisePercent(r.current, r.next));
  return {
    payroll, budget, allocated, left: budget - allocated, percent: raisePercent(payroll, payroll + allocated),
    raised: rows.filter((r) => r.next > r.current).length, minPercent: pcts.length ? Math.min(...pcts) : 0, maxPercent: pcts.length ? Math.max(...pcts) : 0,
  };
}

/**
 * Retroaktiv lön: skillnaden för lön som redan betalats ut för månader från och med att den nya lönen gäller.
 * paidPeriods = de månader (ÅÅÅÅ-MM) som den anställda fått lön i en bokförd lönekörning.
 * Gäller den nya lönen från mitten av en månad räknas den månaden proportionellt per kalenderdag.
 */
export function retroAmount(diff: number, effectiveDate: string, paidPeriods: string[]): number {
  if (diff <= 0) return 0;
  const first = effectiveDate.slice(0, 7);
  const y = Number(effectiveDate.slice(0, 4)), m = Number(effectiveDate.slice(5, 7)), d = Number(effectiveDate.slice(8, 10));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let total = 0;
  for (const p of new Set(paidPeriods)) {
    if (p < first) continue;
    total += p === first ? Math.round((diff * (days - d + 1)) / days) : diff;
  }
  return total;
}

/** Juridiskt kön ur personnummer (näst sista siffran: udda = man, jämn = kvinna). Används bara för lönekartläggning. */
export function legalSex(personalNumber: string): 'K' | 'M' | null {
  const digits = personalNumber.replace(/\D/g, '');
  if (digits.length < 10) return null;
  return Number(digits[digits.length - 2]) % 2 === 1 ? 'M' : 'K';
}

export interface PayGroup { group: string; women: number; men: number; avgWomen: number | null; avgMen: number | null; ratio: number | null }

/** Lönekartläggning: snittlön per grupp (befattning) och kön. Kvinnors lön i procent av mäns där båda finns. */
export function payGroups(rows: { group: string; sex: 'K' | 'M' | null; salary: number }[]): PayGroup[] {
  const map = new Map<string, { w: number[]; m: number[] }>();
  for (const r of rows) {
    const g = map.get(r.group) ?? { w: [], m: [] };
    if (r.sex === 'K') g.w.push(r.salary);
    if (r.sex === 'M') g.m.push(r.salary);
    map.set(r.group, g);
  }
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null);
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, 'sv')).map(([group, g]) => {
    const aw = avg(g.w), am = avg(g.m);
    return { group, women: g.w.length, men: g.m.length, avgWomen: aw, avgMen: am, ratio: aw != null && am ? Math.round((aw / am) * 1000) / 10 : null };
  });
}

/** Skillnad som ska analyseras: kvinnors lön under 95 % av mäns (eller tvärtom) när båda könen finns i gruppen */
export const FLAG_RATIO = 95;
export const flagged = (g: PayGroup) => g.ratio != null && (g.ratio < FLAG_RATIO || g.ratio > 10000 / FLAG_RATIO);
/** Likvärdigt arbete: grupper per kravnivå (1–6) enligt en arbetsvärdering */
export function levelGroups(rows: { level: number | null; sex: 'K' | 'M' | null; salary: number }[]) {
  return payGroups(rows.filter((r) => r.level != null).map((r) => ({ group: `Kravnivå ${r.level}`, sex: r.sex, salary: r.salary })));
}
