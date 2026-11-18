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

/** Summerar bolagen och eliminerar koncerninterna intäkter/kostnader och fordringar/skulder */
export function consolidate(cs: GroupCompany[]) {
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
  const result = total(RESULT_GROUPS, (p) => p.r, elimR);
  const balance = total(BALANCE_GROUPS, (p) => p.b, elimB);
  const consolidatedResult = perCompany.reduce((s, p) => s + p.r.result, 0); // elimineringarna tar ut varandra
  return { perCompany, elimR, elimB, result, balance, consolidatedResult, intraSales: sales, intraOpen: open };
}

export const orgDigits = (s: string) => s.replace(/\D/g, '').slice(-10);
