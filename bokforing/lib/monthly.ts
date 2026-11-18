// Månadsrapport till ägaren – ren logik (testbar)
export const RESULT_GROUPS = [
  { key: 'revenue', label: 'Intäkter', from: 3000, to: 3999, sign: -1 },
  { key: 'goods', label: 'Varor och material', from: 4000, to: 4999, sign: 1 },
  { key: 'external', label: 'Övriga externa kostnader', from: 5000, to: 6999, sign: 1 },
  { key: 'staff', label: 'Personal', from: 7000, to: 7699, sign: 1 },
  { key: 'depreciation', label: 'Avskrivningar', from: 7700, to: 7899, sign: 1 },
  { key: 'financial', label: 'Finansiella poster och skatt', from: 7900, to: 8999, sign: -1 },
] as const;
export type GroupKey = (typeof RESULT_GROUPS)[number]['key'];

/** Summerar resultatkontona per grupp. Intäkter och finansiella poster positiva när de ökar resultatet. */
export function groupSums(sums: Map<number, number>): Record<GroupKey, number> & { result: number } {
  const g = Object.fromEntries(RESULT_GROUPS.map((x) => [x.key, 0])) as Record<GroupKey, number>;
  let result = 0;
  for (const [acc, v] of sums) {
    const grp = RESULT_GROUPS.find((x) => acc >= x.from && acc <= x.to);
    if (!grp) continue;
    g[grp.key] += grp.sign * Number(v);
    result -= Number(v);
  }
  return { ...g, result };
}

export const sumRange = (m: Map<number, number>, from: number, to: number) => [...m].filter(([a]) => a >= from && a <= to).reduce((s, [, v]) => s + Number(v), 0);

/** Förändring i procent, null om jämförelsetalet är 0 */
export const change = (now: number, before: number) => (before ? Math.round(((now - before) / Math.abs(before)) * 1000) / 10 : null);

/** Korta iakttagelser i klartext */
export function highlights(o: { revenue: number; revenuePrev: number; result: number; cash: number; cashPrev: number; overdue: number; overdueCount: number; vatDue: number }): string[] {
  const out: string[] = [];
  const kr = (v: number) => `${Math.round(v / 100).toLocaleString('sv-SE')} kr`;
  const c = change(o.revenue, o.revenuePrev);
  if (c != null && Math.abs(c) >= 10) out.push(`Intäkterna ${c > 0 ? 'ökade' : 'minskade'} med ${Math.abs(c).toLocaleString('sv-SE')} % jämfört med samma månad i fjol.`);
  out.push(o.result >= 0 ? `Månaden gick med vinst, ${kr(o.result)}.` : `Månaden gick med förlust, ${kr(-o.result)}.`);
  if (o.cash < o.cashPrev) out.push(`Kassan minskade med ${kr(o.cashPrev - o.cash)} under månaden.`);
  else if (o.cash > o.cashPrev) out.push(`Kassan ökade med ${kr(o.cash - o.cashPrev)} under månaden.`);
  if (o.overdueCount) out.push(`${o.overdueCount} kundfakturor är förfallna, ${kr(o.overdue)} – skicka påminnelser.`);
  if (o.vatDue > 0) out.push(`Moms att betala enligt bokföringen: ${kr(o.vatDue)}.`);
  return out;
}
