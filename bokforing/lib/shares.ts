// Aktiebok (aktiebolagslagen 5 kap.): aktienummer i serier, överlåtelser och nyemission. Ren logik, belopp i öre.

export interface Range { from: number; to: number }
export const count = (rs: Range[]) => rs.reduce((s, r) => s + (r.to - r.from + 1), 0);

/** Slår ihop angränsande nummerserier */
export function normalize(rs: Range[]): Range[] {
  const s = [...rs].filter((r) => r.to >= r.from).sort((a, b) => a.from - b.from);
  const out: Range[] = [];
  for (const r of s) {
    const last = out[out.length - 1];
    if (last && r.from <= last.to + 1) last.to = Math.max(last.to, r.to); else out.push({ ...r });
  }
  return out;
}

/** Överlåtelse: de lägsta numren tas från säljarens serier */
export function take(rs: Range[], n: number): { taken: Range[]; left: Range[] } {
  if (!Number.isInteger(n) || n <= 0) throw new Error('Ange antal aktier');
  if (n > count(rs)) throw new Error('Säljaren äger inte så många aktier');
  const taken: Range[] = [], left: Range[] = [];
  let need = n;
  for (const r of normalize(rs)) {
    const size = r.to - r.from + 1;
    if (need <= 0) { left.push(r); continue; }
    if (size <= need) { taken.push(r); need -= size; }
    else { taken.push({ from: r.from, to: r.from + need - 1 }); left.push({ from: r.from + need, to: r.to }); need = 0; }
  }
  return { taken, left };
}

export const fmtRanges = (rs: Range[]) => normalize(rs).map((r) => (r.from === r.to ? `${r.from}` : `${r.from}–${r.to}`)).join(', ');

/** Kvotvärde = aktiekapital / antal aktier */
export const quotaValue = (shareCapital: number, shares: number) => (shares > 0 ? shareCapital / shares : 0);

/**
 * Nyemission: inbetalt belopp delas på aktiekapital (kvotvärde × nya aktier) och överkurs.
 * Före registrering bokas aktiekapitalet på 2082 Ej registrerat aktiekapital; vid registreringen flyttas det till 2081.
 */
export function issueEntries(o: { newShares: number; pricePerShare: number; quota: number }) {
  const total = Math.round(o.newShares * o.pricePerShare);
  const capital = Math.round(o.newShares * o.quota);
  if (total < capital) throw new Error('Teckningskursen får inte vara lägre än kvotvärdet');
  return { total, capital, premium: total - capital,
    payment: [{ account: 1930, amount: total }, { account: 2082, amount: -capital }, ...(total > capital ? [{ account: 2097, amount: -(total - capital) }] : [])],
    registration: [{ account: 2082, amount: capital }, { account: 2081, amount: -capital }] };
}

/** Andel av rösterna med A-aktier (10 röster) och B-aktier (1 röst) */
export function ownership(holders: { key: string; a: number; b: number }[]) {
  const shares = holders.reduce((s, h) => s + h.a + h.b, 0), votes = holders.reduce((s, h) => s + h.a * 10 + h.b, 0);
  return holders.map((h) => ({ key: h.key, shares: h.a + h.b, pct: shares ? ((h.a + h.b) / shares) * 100 : 0, votePct: votes ? ((h.a * 10 + h.b) / votes) * 100 : 0 }));
}
