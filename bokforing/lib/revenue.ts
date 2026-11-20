// Abonnemangsintäkter (ren logik): periodisering av fakturerad tjänsteperiod per månad och nyckeltal (MRR, ARR, churn). Belopp i öre.
export const DEFERRED_REVENUE = 2970; // Förutbetalda intäkter

const dayMs = 864e5;
const d = (s: string) => Date.parse(`${s}T00:00:00Z`);
const monthEnd = (p: string) => { const [y, m] = p.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

/** Beloppet fördelat per kalendermånad efter antal dagar i tjänsteperioden (avrundningen läggs på sista månaden) */
export function splitByMonth(amount: number, from: string, to: string): { period: string; amount: number }[] {
  if (to < from) throw new Error('Tjänsteperioden slutar före start');
  const days = Math.round((d(to) - d(from)) / dayMs) + 1;
  const out: { period: string; amount: number }[] = [];
  let cur = from;
  while (cur <= to) {
    const p = cur.slice(0, 7);
    const end = monthEnd(p) < to ? monthEnd(p) : to;
    const n = Math.round((d(end) - d(cur)) / dayMs) + 1;
    out.push({ period: p, amount: Math.round((amount * n) / days) });
    cur = new Date(d(end) + dayMs).toISOString().slice(0, 10);
  }
  out[out.length - 1].amount += amount - out.reduce((s, x) => s + x.amount, 0);
  return out;
}

/**
 * Vid bokföringen: intäkter för månader efter fakturamånaden flyttas till förutbetalda intäkter (2970).
 * Varje månad därefter förs månadens del tillbaka till intäktskontot.
 */
export function deferral(lines: { account: number; net: number }[], from: string, to: string, invoicePeriod: string) {
  const schedules: { account: number; period: string; amount: number; now: boolean }[] = [];
  for (const l of lines) for (const m of splitByMonth(l.net, from, to)) schedules.push({ account: l.account, period: m.period, amount: m.amount, now: m.period <= invoicePeriod });
  const later = schedules.filter((s) => !s.now);
  const byAcc = new Map<number, number>();
  for (const s of later) byAcc.set(s.account, (byAcc.get(s.account) ?? 0) + s.amount);
  const total = later.reduce((s, x) => s + x.amount, 0);
  const lines2 = total ? [...[...byAcc].map(([account, amount]) => ({ account, amount })), { account: DEFERRED_REVENUE, amount: -total }] : [];
  return { schedules, deferred: total, lines: lines2 };
}

export const releaseLines = (items: { account: number; amount: number }[]) => {
  const byAcc = new Map<number, number>();
  for (const i of items) byAcc.set(i.account, (byAcc.get(i.account) ?? 0) + i.amount);
  const total = items.reduce((s, x) => s + x.amount, 0);
  return [{ account: DEFERRED_REVENUE, amount: total }, ...[...byAcc].map(([account, amount]) => ({ account, amount: -amount }))];
};

/**
 * MRR per månad (periodiserad abonnemangsintäkt), ARR och förändring per kund mot föregående månad:
 * ny, utökad, minskad och förlorad (churn) samt nettointäktsretention.
 */
export function metrics(byCustomer: Map<number, Map<string, number>>, period: string, prevPeriod: string) {
  let mrr = 0, prev = 0, added = 0, expansion = 0, contraction = 0, churned = 0, churnedCustomers = 0, newCustomers = 0, active = 0;
  for (const [, months] of byCustomer) {
    const a = months.get(period) ?? 0, b = months.get(prevPeriod) ?? 0;
    mrr += a; prev += b;
    if (a > 0) active++;
    if (b === 0 && a > 0) { added += a; newCustomers++; }
    else if (b > 0 && a === 0) { churned += b; churnedCustomers++; }
    else if (a > b) expansion += a - b;
    else if (a < b) contraction += b - a;
  }
  const retained = prev - churned - contraction + expansion;
  return { mrr, arr: mrr * 12, prev, added, expansion, contraction, churned, churnedCustomers, newCustomers, active,
    nrr: prev ? Math.round((retained / prev) * 1000) / 10 : null, churnRate: prev ? Math.round((churned / prev) * 1000) / 10 : null };
}
