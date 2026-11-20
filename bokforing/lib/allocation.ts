// Kostnadsfördelning och internfakturering mellan kostnadsställen (ren logik). Belopp i öre.
export const INTERNAL_ACCOUNT = 6999; // Interna debiteringar (nollsummekonto – belastar mottagaren och avlastar avsändaren)

/** Fördelar ett belopp efter vikter (t.ex. kvm eller antal anställda); avrundningen läggs på största vikten */
export function allocate(amount: number, weights: { id: number; weight: number }[]) {
  const total = weights.reduce((s, w) => s + w.weight, 0);
  if (!(total > 0)) throw new Error('Fördelningsnyckeln saknar vikter');
  const out = weights.map((w) => ({ id: w.id, amount: Math.round((amount * w.weight) / total) }));
  const diff = amount - out.reduce((s, x) => s + x.amount, 0);
  out[weights.indexOf(weights.reduce((a, b) => (b.weight > a.weight ? b : a)))].amount += diff;
  return out;
}

/**
 * Verifikationsrader för en fördelning: kostnaden på varje konto flyttas från källan (kostnadsställe eller utan)
 * till mottagarna efter nyckeln. Varje konto nollas för källan och summan är oförändrad.
 */
export function allocationLines(costs: { account: number; amount: number }[], source: number | null, weights: { id: number; weight: number }[]) {
  const l: { account: number; amount: number; costCenterId: number | null }[] = [];
  for (const c of costs) {
    if (!c.amount) continue;
    l.push({ account: c.account, amount: -c.amount, costCenterId: source });
    for (const a of allocate(c.amount, weights)) if (a.amount) l.push({ account: c.account, amount: a.amount, costCenterId: a.id });
  }
  return l;
}

/** Interndebitering: mottagaren belastas och avsändaren avlastas på samma konto, så att bolagets resultat är oförändrat */
export const internalLines = (o: { from: number; to: number; amount: number }) => [
  { account: INTERNAL_ACCOUNT, amount: o.amount, costCenterId: o.to },
  { account: INTERNAL_ACCOUNT, amount: -o.amount, costCenterId: o.from },
];

/** Resultat per avdelning: intäkter, rörliga kostnader (4xxx) och täckningsbidrag, övriga kostnader, fördelat in och resultat */
export function departmentResult(rows: { account: number; amount: number; allocated: boolean }[]) {
  const sum = (f: (r: typeof rows[number]) => boolean) => rows.filter(f).reduce((s, r) => s + r.amount, 0);
  const revenue = sum((r) => r.account >= 3000 && r.account <= 3999);           // kredit positiv
  const variable = -sum((r) => r.account >= 4000 && r.account <= 4999 && !r.allocated);
  const contribution = revenue - variable;
  const other = -sum((r) => r.account >= 5000 && r.account <= 8999 && !r.allocated && r.account !== INTERNAL_ACCOUNT);
  const internal = -sum((r) => r.account === INTERNAL_ACCOUNT && !r.allocated);
  const allocated = -sum((r) => r.allocated);
  return { revenue, variable, contribution, tbPct: revenue ? Math.round((contribution / revenue) * 1000) / 10 : null, other, internal, allocated, result: contribution - other - internal - allocated };
}
