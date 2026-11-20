// Handelsbolag och kommanditbolag (ren logik): delägarnas kapitalkonton, resultatfördelning, uttag/insättningar och underlag
// till INK4 och N3B. BAS: delägare 1 på 2010–2019, delägare 2 på 2020–2029 osv. (högst fyra delägare). Belopp i öre.
export type CompanyType = 'AB' | 'EF' | 'HB' | 'KB';
export const COMPANY_TYPE_LABEL: Record<CompanyType, string> = { AB: 'Aktiebolag', EF: 'Enskild firma', HB: 'Handelsbolag', KB: 'Kommanditbolag' };
export const isPartnership = (t: string): t is 'HB' | 'KB' => t === 'HB' || t === 'KB';
/** Bolagsformer som beskattas hos ägaren (ingen bolagsskatt): enskild firma och handelsbolag */
export const ownerTaxed = (t: string) => t === 'EF' || isPartnership(t);

export const MAX_PARTNERS = 4;
export const partnerBase = (n: number) => { if (n < 1 || n > MAX_PARTNERS) throw new Error('Högst fyra delägare'); return 2000 + n * 10; };
export const partnerAccounts = (n: number) => { const b = partnerBase(n); return { capital: b, withdrawals: b + 3, contributions: b + 8, result: b + 9 }; };
export const partnerOfAccount = (acc: number) => (acc >= 2010 && acc <= 2049 ? Math.floor((acc - 2000) / 10) : null);

export interface Partner { n: number; name: string; sharePct: number; limited: boolean; contribution: number }

/** Andelarna ska summera till 100 %; ett kommanditbolag ska ha minst en komplementär (obegränsat ansvar) och en kommanditdelägare */
export function validatePartners(type: 'HB' | 'KB', ps: Partner[]): string | null {
  if (ps.length < 2) return 'Ett handels- eller kommanditbolag har minst två delägare';
  const sum = Math.round(ps.reduce((s, p) => s + p.sharePct, 0) * 100) / 100;
  if (sum !== 100) return `Andelarna i resultatet ska summera till 100 % (nu ${sum.toLocaleString('sv-SE')} %)`;
  if (type === 'KB' && (!ps.some((p) => p.limited) || !ps.some((p) => !p.limited))) return 'Ett kommanditbolag har minst en komplementär och minst en kommanditdelägare';
  if (type === 'HB' && ps.some((p) => p.limited)) return 'I ett handelsbolag har alla delägare obegränsat ansvar';
  return null;
}

/** Årets resultat (vinst positiv) fördelat efter andel; öresavrundning till delägaren med störst andel */
export function distribute(result: number, ps: Partner[]) {
  const out = ps.map((p) => ({ n: p.n, amount: Math.round((result * p.sharePct) / 100) }));
  const diff = result - out.reduce((s, x) => s + x.amount, 0);
  const big = ps.reduce((m, p) => (p.sharePct > m.sharePct ? p : m));
  out.find((x) => x.n === big.n)!.amount += diff;
  return out;
}

/** Bokning av årets resultat: 8999 mot respektive delägares 20x9 */
export function resultLines(result: number, ps: Partner[]) {
  return [{ account: 8999, amount: result }, ...distribute(result, ps).filter((d) => d.amount).map((d) => ({ account: partnerAccounts(d.n).result, amount: -d.amount }))];
}

/** Nytt år: årets resultat, uttag och insättningar förs till delägarens eget kapital (20x0) */
export function carryLines(balances: Map<number, number>, ps: Partner[]) {
  const l: { account: number; amount: number }[] = [];
  for (const p of ps) {
    const a = partnerAccounts(p.n);
    let total = 0;
    for (let acc = a.capital + 1; acc <= a.result; acc++) { const v = balances.get(acc) ?? 0; if (v) { l.push({ account: acc, amount: -v }); total += v; } }
    if (total) l.push({ account: a.capital, amount: total });
  }
  return l;
}

/** Uttag eller insättning för en delägare */
export function ownerLines(o: { n: number; kind: 'withdrawal' | 'contribution'; amount: number; bank: number }) {
  const a = partnerAccounts(o.n);
  return o.kind === 'withdrawal' ? [{ account: a.withdrawals, amount: o.amount }, { account: o.bank, amount: -o.amount }] : [{ account: o.bank, amount: o.amount }, { account: a.contributions, amount: -o.amount }];
}

/** Delägarens kapitalkonto (eget kapital, kredit positiv) */
export function capitalOf(balances: Map<number, number>, n: number) {
  const a = partnerAccounts(n);
  let s = 0;
  for (let acc = a.capital; acc <= a.result; acc++) s -= balances.get(acc) ?? 0;
  return s;
}

/**
 * Underlag till delägarnas N3B: andel av bolagets skattemässiga resultat (bokfört resultat justerat för ej avdragsgilla kostnader och skattefria intäkter).
 * För en kommanditdelägare är avdrag för underskott begränsat till insatsen (inkomstskattelagen 14:14 och 41:20).
 */
export function n3b(o: { result: number; nonDeductible: number; taxFree: number; partners: Partner[] }) {
  const taxable = o.result + o.nonDeductible - o.taxFree;
  return distribute(taxable, o.partners).map((d) => {
    const p = o.partners.find((x) => x.n === d.n)!;
    const capped = p.limited && d.amount < 0 && p.contribution > 0 ? Math.max(d.amount, -p.contribution) : d.amount;
    return { n: d.n, name: p.name, share: p.sharePct, surplus: capped > 0 ? capped : 0, deficit: capped < 0 ? -capped : 0, limitedCapped: capped !== d.amount };
  });
}
