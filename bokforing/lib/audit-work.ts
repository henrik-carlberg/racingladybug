// Revisorns arbetsyta – ren logik (testbar): stickprov och kontrollpunkter per balanspost.

export interface VoucherInfo { id: number; date: string; amount: number; user_id: number | null; source_type: string; accounts: number[] }
export type SampleMethod = 'amount' | 'random' | 'account' | 'user' | 'manual' | 'weekend' | 'round' | 'mus';
export const SAMPLE_LABEL: Record<SampleMethod, string> = {
  amount: 'Över väsentlighetsbeloppet', random: 'Slumpmässigt urval', account: 'Konton', user: 'Bokförda av en viss användare',
  manual: 'Manuella verifikationer', weekend: 'Bokförda på helgdag', round: 'Jämna belopp', mus: 'Beloppsviktat urval (MUS)',
};

/** Deterministisk slump (samma urval varje gång för samma frö) */
export function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export function drawSample(vs: VoucherInfo[], o: { method: SampleMethod; threshold?: number; count?: number; seed?: number; from?: number; to?: number; userId?: number }): { id: number; reason: string }[] {
  const n = Math.min(200, Math.max(1, o.count ?? 25));
  const kr = (x: number) => `${Math.round(x / 100).toLocaleString('sv-SE')} kr`;
  switch (o.method) {
    case 'amount': { const t = o.threshold ?? 0; return vs.filter((v) => v.amount >= t).sort((a, b) => b.amount - a.amount).slice(0, n).map((v) => ({ id: v.id, reason: `Belopp ${kr(v.amount)} ≥ ${kr(t)}` })); }
    case 'account': { const a = o.from ?? 1000, b = o.to ?? a; return vs.filter((v) => v.accounts.some((x) => x >= a && x <= b)).slice(0, n).map((v) => ({ id: v.id, reason: `Konto ${a}${b !== a ? `–${b}` : ''}` })); }
    case 'user': return vs.filter((v) => v.user_id === o.userId).slice(0, n).map((v) => ({ id: v.id, reason: 'Bokförd av vald användare' }));
    case 'manual': return vs.filter((v) => v.source_type === 'manual').sort((a, b) => b.amount - a.amount).slice(0, n).map((v) => ({ id: v.id, reason: 'Manuell verifikation' }));
    case 'weekend': return vs.filter((v) => { const d = new Date(v.date + 'T00:00:00Z').getUTCDay(); return d === 0 || d === 6; }).slice(0, n).map((v) => ({ id: v.id, reason: 'Daterad på helgdag' }));
    case 'round': return vs.filter((v) => v.amount >= 100000 && v.amount % 100000 === 0).sort((a, b) => b.amount - a.amount).slice(0, n).map((v) => ({ id: v.id, reason: `Jämnt belopp ${kr(v.amount)}` }));
    case 'mus': return musSample(vs, o.threshold ?? 0, o.seed ?? 1).slice(0, n);
    case 'random': {
      const rnd = seeded(o.seed ?? 1), pool = [...vs].sort((a, b) => a.id - b.id);
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      return pool.slice(0, n).sort((a, b) => a.date.localeCompare(b.date)).map((v) => ({ id: v.id, reason: 'Slumpmässigt urval' }));
    }
  }
}

/** Kontrollpunkter per balanspost med konton som visas som underlag */
export const CHECKPOINTS: { key: string; title: string; from: number; to: number; hint: string }[] = [
  { key: 'bank', title: 'Kassa och bank', from: 1900, to: 1999, hint: 'Saldot stämmer mot kontoutdrag per balansdagen; alla transaktioner är avstämda.' },
  { key: 'kundfordringar', title: 'Kundfordringar', from: 1500, to: 1599, hint: 'Reskontran stämmer mot huvudboken; gamla fordringar är bedömda (osäkra fordringar).' },
  { key: 'lager', title: 'Varulager', from: 1400, to: 1499, hint: 'Inventering vid årets slut; värdering till lägsta värdets princip.' },
  { key: 'anlaggning', title: 'Anläggningstillgångar', from: 1000, to: 1399, hint: 'Registret stämmer mot bokföringen; avskrivningar och nyanskaffningar har underlag.' },
  { key: 'periodiseringar', title: 'Förutbetalda och upplupna poster', from: 1700, to: 1799, hint: 'Periodiseringar är rimliga och har underlag (även 29xx).' },
  { key: 'eget_kapital', title: 'Eget kapital', from: 2000, to: 2099, hint: 'Förändringar stämmer mot stämmoprotokoll (utdelning, resultatdisposition).' },
  { key: 'leverantorer', title: 'Leverantörsskulder', from: 2400, to: 2499, hint: 'Reskontran stämmer; inga betalningar efter balansdagen som saknas som skuld.' },
  { key: 'skatter', title: 'Skatter och avgifter', from: 2500, to: 2799, hint: 'Skattekontot, moms och personalskatt stämmer mot deklarationer och AGI.' },
  { key: 'intakter', title: 'Intäkter', from: 3000, to: 3999, hint: 'Fakturering i rätt period (cut-off); intäkter stämmer mot momsdeklarationerna.' },
  { key: 'personal', title: 'Löner och personalkostnader', from: 7000, to: 7699, hint: 'Lönerna stämmer mot AGI och lönespecifikationer; semesterlöneskuld är beräknad.' },
];

export interface ReviewRow { status: 'pending' | 'ok' | 'remark'; sent?: boolean }
export function summary(samples: ReviewRow[], checkpoints: ReviewRow[]) {
  const c = (l: ReviewRow[], s: string) => l.filter((x) => x.status === s).length;
  return {
    samples: { total: samples.length, ok: c(samples, 'ok'), remark: c(samples, 'remark'), pending: c(samples, 'pending') },
    checkpoints: { total: checkpoints.length, ok: c(checkpoints, 'ok'), remark: c(checkpoints, 'remark'), pending: c(checkpoints, 'pending') },
    done: !samples.some((x) => x.status === 'pending') && !checkpoints.some((x) => x.status === 'pending'),
  };
}

/**
 * Beloppsviktat urval (monetary unit sampling): varje krona har samma chans att väljas. Poster på minst intervallet
 * (nyckelposter) väljs alltid; övriga väljs systematiskt med slumpad start i intervallet, så stora poster väljs oftare.
 */
export function musSample<T extends { id: number; amount: number }>(items: T[], interval: number, seed = 1): { id: number; reason: string; key: boolean }[] {
  if (!(interval > 0)) throw new Error('Ange genomförandeväsentlighet (intervallet för urvalet)');
  const kr = (x: number) => `${Math.round(x / 100).toLocaleString('sv-SE')} kr`;
  const pool = [...items].filter((i) => Math.abs(i.amount) > 0).sort((a, b) => a.id - b.id);
  const key = pool.filter((i) => Math.abs(i.amount) >= interval);
  const rest = pool.filter((i) => Math.abs(i.amount) < interval);
  const out = key.map((i) => ({ id: i.id, reason: `Nyckelpost ${kr(Math.abs(i.amount))} ≥ intervallet ${kr(interval)}`, key: true }));
  const start = Math.floor(seeded(seed)() * interval);
  let cum = 0, next = start;
  for (const i of rest) {
    const before = cum;
    cum += Math.abs(i.amount);
    if (cum > next && before <= next) {
      out.push({ id: i.id, reason: `Beloppsviktat urval (intervall ${kr(interval)})`, key: false });
      while (next < cum) next += interval;
    }
  }
  return out;
}

/** Förslag till väsentlighet enligt vanliga riktmärken, med genomförandeväsentlighet (75 %) och obetydlighetsgräns (5 %) */
export function materialitySuggestion(b: { revenue: number; profit: number; assets: number }) {
  const down = (x: number) => Math.floor(x / 10000) * 10000; // hela hundralappar
  const options = [
    { basis: 'Omsättning', pct: 1, base: b.revenue },
    { basis: 'Resultat före skatt', pct: 5, base: b.profit },
    { basis: 'Balansomslutning', pct: 1, base: b.assets },
  ].filter((o) => o.base > 0).map((o) => ({ ...o, amount: down((o.base * o.pct) / 100) })).filter((o) => o.amount > 0);
  const best = options.length ? options.reduce((m, o) => (o.amount < m.amount ? o : m)) : null;
  const amount = best?.amount ?? 0;
  return { options, recommended: best, amount, performance: down(amount * 0.75), trivial: down(amount * 0.05) };
}

export interface LedgerItem { id: number; kind: 'customer' | 'supplier'; ref: string; party: string; date: string; due: string; open: number; paidAfter: number; paidAfterDate: string | null }
/** Efterföljande betalning: betalt efter balansdagen styrker fordran/skulden; obetalt äldre än 90 dagar flaggas */
export function ledgerEvidence(i: Pick<LedgerItem, 'open' | 'paidAfter' | 'paidAfterDate' | 'due'>, balanceDate: string) {
  if (i.paidAfter >= i.open && i.paidAfterDate) return { status: 'paid' as const, text: `Betald ${i.paidAfterDate} efter balansdagen` };
  if (i.paidAfter > 0) return { status: 'partly' as const, text: `Delvis betald efter balansdagen (${Math.round(i.paidAfter / 100).toLocaleString('sv-SE')} kr)` };
  const days = Math.round((Date.parse(balanceDate) - Date.parse(i.due)) / 864e5);
  return { status: 'open' as const, text: days > 90 ? `Obetald, förföll för ${days} dagar sedan – bedöm som osäker` : 'Obetald – begär saldobekräftelse' };
}
