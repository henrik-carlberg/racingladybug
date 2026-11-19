// Koncernsammanställning – ren logik (testbar)
import { groupSums, RESULT_GROUPS, sumRange, type GroupKey } from './monthly';

export const BALANCE_GROUPS = [
  { key: 'fixed', label: 'Anläggningstillgångar', from: 1000, to: 1399, sign: 1 },
  { key: 'current', label: 'Omsättningstillgångar (exkl. kassa)', from: 1400, to: 1899, sign: 1 },
  { key: 'cash', label: 'Kassa och bank', from: 1900, to: 1999, sign: 1 },
  { key: 'equity', label: 'Eget kapital', from: 2000, to: 2099, sign: -1 },
  { key: 'untaxed', label: 'Obeskattade reserver och avsättningar', from: 2100, to: 2299, sign: -1 },
  { key: 'longterm', label: 'Långfristiga skulder', from: 2300, to: 2399, sign: -1 },
  { key: 'shortterm', label: 'Kortfristiga skulder', from: 2400, to: 2999, sign: -1 },
] as const;
export type BalanceKey = (typeof BALANCE_GROUPS)[number]['key'];

export interface GroupCompany { id: number; name: string; result: Map<number, number>; balance: Map<number, number>; intraSales: number; intraOpen: number }
export interface GroupLink { subsidiaryId: number; ownership: number; acquisitionCost: number | null; acquiredEquity: number | null }
export interface ElimEntry { label: string; amount: number }

/**
 * Summerar bolagen och eliminerar:
 *  - koncernintern försäljning och obetalda koncerninterna fakturor (kunder med ett annat bolags organisationsnummer)
 *  - fordringar och skulder på koncernkontona (1320–1329, 1660–1669 mot 2360–2369, 2860–2869)
 *  - med moderbolag: utdelning från dotterbolag (8010–8019) och aktier i dotterbolag (1310–1319) mot eget kapital vid förvärvet,
 *    med goodwill (eller negativ goodwill) och minoritetens andel av eget kapital och resultat
 */
export function consolidate(cs: GroupCompany[], opts: { parentId?: number | null; links?: GroupLink[] } = {}) {
  const perCompany = cs.map((c) => {
    const r = groupSums(c.result);
    const b = Object.fromEntries(BALANCE_GROUPS.map((g) => [g.key, g.sign * sumRange(c.balance, g.from, g.to)])) as Record<BalanceKey, number>;
    // Eget kapital innehåller redan resultatet till och med datumet (se openingBalances)
    return { id: c.id, name: c.name, r, b };
  });
  const sales = cs.reduce((s, c) => s + c.intraSales, 0), open = cs.reduce((s, c) => s + c.intraOpen, 0);
  const elimR = Object.fromEntries(RESULT_GROUPS.map((g) => [g.key, 0])) as Record<GroupKey, number>;
  elimR.revenue = -sales; elimR.external = -sales;
  const elimB = Object.fromEntries(BALANCE_GROUPS.map((g) => [g.key, 0])) as Record<BalanceKey, number>;
  elimB.current = -open; elimB.shortterm = -open;
  const total = <K extends string>(keys: readonly { key: K }[], pick: (p: (typeof perCompany)[number]) => Record<K, number>, elim: Record<K, number>) =>
    Object.fromEntries(keys.map((g) => [g.key, perCompany.reduce((s, p) => s + pick(p)[g.key], 0) + elim[g.key]])) as Record<K, number>;
  const entries: ElimEntry[] = [];
  if (sales) entries.push({ label: 'Koncernintern försäljning', amount: sales });
  if (open) entries.push({ label: 'Obetalda koncerninterna fakturor', amount: open });
  let resultAdj = 0, minority = 0, minorityResult = 0, goodwill = 0;
  const warnings: string[] = [];
  if (cs.length > 1) {
    const sum = (f: number, t: number) => cs.reduce((a, c) => a + sumRange(c.balance, f, t), 0);
    const recLong = sum(1320, 1329), recShort = sum(1660, 1669), liabLong = -sum(2360, 2369), liabShort = -sum(2860, 2869);
    if (recLong || recShort || liabLong || liabShort) {
      elimB.fixed -= recLong; elimB.current -= recShort; elimB.longterm -= liabLong; elimB.shortterm -= liabShort;
      const diff = recLong + recShort - liabLong - liabShort;
      if (diff) { elimB.equity -= diff; warnings.push(`Koncernmellanhavandena går inte jämnt ut (fordringar ${recLong + recShort}, skulder ${liabLong + liabShort}) – differensen ${diff} har förts mot eget kapital och bör utredas`); }
      entries.push({ label: 'Fordringar och skulder mellan koncernbolagen', amount: Math.min(recLong + recShort, liabLong + liabShort) });
    }
  }
  const parent = opts.parentId != null ? cs.find((c) => c.id === opts.parentId) : undefined;
  if (parent) {
    const div = -sumRange(parent.result, 8010, 8019);
    if (div) { elimR.financial -= div; resultAdj -= div; entries.push({ label: 'Utdelning från dotterbolag', amount: div }); }
    const links = (opts.links ?? []).filter((l) => l.subsidiaryId !== parent.id && cs.some((c) => c.id === l.subsidiaryId));
    for (const l of links) {
      const sub = perCompany.find((p) => p.id === l.subsidiaryId)!;
      const subC = cs.find((c) => c.id === l.subsidiaryId)!;
      const own = Math.min(100, Math.max(0, l.ownership)) / 100;
      const cost = l.acquisitionCost ?? (links.length === 1 ? sumRange(parent.balance, 1310, 1319) : 0);
      if (l.acquisitionCost == null && links.length > 1) warnings.push(`${sub.name}: ange aktiernas anskaffningsvärde – moderbolaget har flera dotterbolag`);
      const acqEq = l.acquiredEquity ?? -sumRange(subC.balance, 2080, 2089);
      const gw = Math.round(cost - own * acqEq);
      elimB.fixed -= cost;
      if (gw >= 0) elimB.fixed += gw; else elimB.untaxed += -gw;
      elimB.equity -= Math.round(own * acqEq);
      goodwill += gw;
      entries.push({ label: `Aktier i ${sub.name} mot eget kapital vid förvärvet`, amount: cost });
      if (gw) entries.push({ label: gw > 0 ? `Koncernmässig goodwill ${sub.name}` : `Negativ goodwill ${sub.name}`, amount: Math.abs(gw) });
      if (own < 1) {
        const m = Math.round((1 - own) * sub.b.equity);
        elimB.equity -= m; minority += m; minorityResult += Math.round((1 - own) * sub.r.result);
        entries.push({ label: `Minoritetens andel i ${sub.name} (${Math.round((1 - own) * 1000) / 10} %)`, amount: m });
      }
    }
  }
  const result = total(RESULT_GROUPS, (p) => p.r, elimR);
  const balance = total(BALANCE_GROUPS, (p) => p.b, elimB);
  const consolidatedResult = perCompany.reduce((s, p) => s + p.r.result, 0) + resultAdj; // försäljningselimineringen tar ut sig själv
  return { perCompany, elimR, elimB, result, balance, consolidatedResult, intraSales: sales, intraOpen: open, entries, warnings, minority, minorityResult, goodwill, parentResult: consolidatedResult - minorityResult };
}

export const orgDigits = (s: string) => s.replace(/\D/g, '').slice(-10);
