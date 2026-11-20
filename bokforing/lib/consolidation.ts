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
export interface GroupLink {
  subsidiaryId: number; ownership: number; acquisitionCost: number | null; acquiredEquity: number | null;
  acquiredOn?: string | null; goodwillYears?: number; surplus?: number; surplusYears?: number;
  intraInventory?: number; intraInventoryOpening?: number; intraMargin?: number;
}
export const DEFERRED_TAX_RATE = 0.206;

/** Andel av en avskrivningstid som har gått mellan två datum (0–1) */
export function elapsed(fromIso: string, toIso: string, years: number) {
  if (!(years > 0)) return 0;
  const d = (Date.parse(toIso) - Date.parse(fromIso)) / 864e5 + 1;
  return Math.max(0, Math.min(1, d / (years * 365.25)));
}

/**
 * Förvärvsanalys (förvärvsmetoden, K3 kap. 19): identifierbara nettotillgångar till verkligt värde = eget kapital vid förvärvet
 * plus övervärden minus uppskjuten skatt på övervärdena. Goodwill = anskaffningsvärde − ägd andel av nettotillgångarna.
 * Goodwill och övervärden skrivs av från förvärvsdagen (goodwill normalt högst 10 år, K3 18.20).
 */
export function acquisitionAnalysis(o: { cost: number; ownership: number; equity: number; surplus?: number; acquiredOn?: string | null; goodwillYears?: number; surplusYears?: number }, period?: { from: string; to: string }) {
  const own = Math.min(100, Math.max(0, o.ownership)) / 100;
  const surplus = Math.max(0, o.surplus ?? 0);
  const deferredTax = Math.round(surplus * DEFERRED_TAX_RATE);
  const fairNet = o.equity + surplus - deferredTax;
  const goodwill = Math.round(o.cost - own * fairNet);
  const gwYears = o.goodwillYears ?? 5, sYears = o.surplusYears ?? 10;
  const acc = (v: number, years: number, at?: string) => (o.acquiredOn && at ? Math.round(v * elapsed(o.acquiredOn, at, years)) : 0);
  const prevDay = (iso: string) => new Date(Date.parse(iso) - 864e5).toISOString().slice(0, 10);
  const gwPos = Math.max(0, goodwill);
  const atTo = { gw: acc(gwPos, gwYears, period?.to), s: acc(surplus, sYears, period?.to), dt: acc(deferredTax, sYears, period?.to) };
  const before = period && o.acquiredOn && o.acquiredOn < period.from ? { gw: acc(gwPos, gwYears, prevDay(period.from)), s: acc(surplus, sYears, prevDay(period.from)), dt: acc(deferredTax, sYears, prevDay(period.from)) } : { gw: 0, s: 0, dt: 0 };
  return {
    own, surplus, deferredTax, fairNet, goodwill, minorityAtAcquisition: Math.round((1 - own) * fairNet),
    accumulated: atTo, period: { gw: atTo.gw - before.gw, s: atTo.s - before.s, dt: atTo.dt - before.dt },
    remaining: { gw: gwPos - atTo.gw, s: surplus - atTo.s, dt: deferredTax - atTo.dt },
    longGoodwill: gwYears > 10,
  };
}

/** Internvinst i lager: koncernintern marginal på varor som finns kvar hos köparen vid periodens början och slut */
export function inventoryProfit(closing: number, opening: number, marginPct: number) {
  const m = Math.max(0, Math.min(100, marginPct)) / 100;
  const c = Math.round(Math.max(0, closing) * m), o = Math.round(Math.max(0, opening) * m);
  return { closing: c, opening: o, change: c - o };
}
export interface ElimEntry { label: string; amount: number }

/**
 * Summerar bolagen och eliminerar:
 *  - koncernintern försäljning och obetalda koncerninterna fakturor (kunder med ett annat bolags organisationsnummer)
 *  - fordringar och skulder på koncernkontona (1320–1329, 1660–1669 mot 2360–2369, 2860–2869)
 *  - med moderbolag: utdelning från dotterbolag (8010–8019) och aktier i dotterbolag (1310–1319) mot eget kapital vid förvärvet,
 *    med goodwill (eller negativ goodwill) och minoritetens andel av eget kapital och resultat
 */
export function consolidate(cs: GroupCompany[], opts: { parentId?: number | null; links?: GroupLink[]; period?: { from: string; to: string } } = {}) {
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
  const analyses: { id: number; name: string; ownership: number; acquiredOn: string | null; cost: number; equity: number; a: ReturnType<typeof acquisitionAnalysis> }[] = [];
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
      const a = acquisitionAnalysis({ cost, ownership: l.ownership, equity: acqEq, surplus: l.surplus, acquiredOn: l.acquiredOn, goodwillYears: l.goodwillYears, surplusYears: l.surplusYears }, opts.period);
      const gw = a.goodwill;
      analyses.push({ id: sub.id, name: sub.name, ownership: l.ownership, acquiredOn: l.acquiredOn ?? null, cost, equity: acqEq, a });
      // Kapitaleliminering: aktierna ut, kvarvarande goodwill och övervärden in, uppskjuten skatt som avsättning
      const net = -cost + (gw >= 0 ? a.remaining.gw : gw) + a.remaining.s - a.remaining.dt;
      const minS = Math.round((1 - a.own) * (a.remaining.s - a.remaining.dt));
      elimB.fixed += -cost + (gw >= 0 ? a.remaining.gw : 0) + a.remaining.s;
      if (gw < 0) elimB.untaxed += -gw;
      elimB.untaxed += a.remaining.dt;
      elimB.equity += net - minS;
      minority += minS;
      goodwill += gw;
      entries.push({ label: `Aktier i ${sub.name} mot eget kapital vid förvärvet`, amount: cost });
      if (gw) entries.push({ label: gw > 0 ? `Koncernmässig goodwill ${sub.name}` : `Negativ goodwill ${sub.name}`, amount: Math.abs(gw) });
      if (a.surplus) entries.push({ label: `Övervärde ${sub.name} (uppskjuten skatt ${Math.round(DEFERRED_TAX_RATE * 1000) / 10} %: ${a.deferredTax})`, amount: a.surplus });
      // Periodens avskrivning på goodwill och övervärden (minus återförd uppskjuten skatt)
      const dep = a.period.gw + a.period.s;
      if (dep) {
        elimR.depreciation += dep; elimR.financial += a.period.dt; resultAdj -= dep - a.period.dt;
        minorityResult -= Math.round((1 - a.own) * (a.period.s - a.period.dt));
        entries.push({ label: `Avskrivning goodwill och övervärden ${sub.name}`, amount: dep });
      }
      if (a.longGoodwill) warnings.push(`${sub.name}: avskrivningstid för goodwill över 10 år ska motiveras i noterna`);
      // Internvinst i lager hos dotterbolaget (köpt från andra koncernbolag)
      const ip = inventoryProfit(l.intraInventory ?? 0, l.intraInventoryOpening ?? 0, l.intraMargin ?? 0);
      if (ip.closing || ip.opening) {
        elimB.current -= ip.closing; elimB.equity -= ip.closing;
        elimR.goods += ip.change; resultAdj -= ip.change;
        entries.push({ label: `Internvinst i lager ${sub.name}`, amount: ip.closing });
      }
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
  return { perCompany, elimR, elimB, result, balance, consolidatedResult, intraSales: sales, intraOpen: open, entries, warnings, minority, minorityResult, goodwill, analyses, parentResult: consolidatedResult - minorityResult };
}

export const orgDigits = (s: string) => s.replace(/\D/g, '').slice(-10);
