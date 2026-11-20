// Fastighet och uthyrning (ren logik): hyresperioder, indexuppräkning, moms per lokal, depositioner och komponenter. Belopp i öre.
export const RENT_VAT_ACCOUNT = 3913;   // Frivilligt momspliktiga hyresintäkter
export const RENT_EXEMPT_ACCOUNT = 3911; // Hyresintäkter (momsfria)
export const DEPOSIT_ACCOUNT = 2891;     // Mottagna depositioner
export const RETAINED_DEPOSIT_ACCOUNT = 3990; // Kvarhållen deposition (övriga intäkter)
export const LAND_ACCOUNT = 1130;        // Mark – skrivs inte av

export type Billing = 'month' | 'quarter';

/** Perioden en avi avser, givet första dagen i en månad. Kvartalsavier bara i kvartalets första månad. */
export function billingPeriod(billing: Billing, month: string): { key: string; from: string; to: string; months: number; label: string } | null {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Ange månad som ÅÅÅÅ-MM');
  const [y, m] = month.split('-').map(Number);
  const end = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
  if (billing === 'month') return { key: month, from: `${month}-01`, to: end(y, m), months: 1, label: month };
  if ((m - 1) % 3 !== 0) return null;
  const q = (m - 1) / 3 + 1;
  return { key: `${y}-Q${q}`, from: `${month}-01`, to: end(y, m + 2), months: 3, label: `kvartal ${q} ${y}` };
}

/**
 * Indexuppräknad årshyra: bashyra × (1 + andel × (index − basindex) / basindex), aldrig lägre än bashyran.
 * Index är KPI för oktober året före hyresåret (vanligt i lokalhyresavtal). Avrundas till hela kronor.
 */
export function indexedRent(o: { baseRent: number; baseIndex: number | null; index: number | null; share: number }): number {
  if (!o.baseIndex || !o.index || o.index <= o.baseIndex) return o.baseRent;
  const add = (o.baseRent * (o.share / 100) * (o.index - o.baseIndex)) / o.baseIndex;
  return Math.round((o.baseRent + add) / 100) * 100;
}

/** Periodens hyra av årshyran (månad = 1/12, kvartal = 3/12) */
export const periodRent = (yearRent: number, months: number) => Math.round((yearRent * months) / 12);

/** Andel ingående moms på gemensamma kostnader som får dras av: momspliktig yta / uthyrd yta */
export function deductibleShare(premises: { area: number; vatLiable: boolean; let: boolean }[]): number {
  const total = premises.filter((p) => p.let).reduce((s, p) => s + p.area, 0);
  if (!total) return 0;
  return Math.round((premises.filter((p) => p.let && p.vatLiable).reduce((s, p) => s + p.area, 0) / total) * 1000) / 10;
}

/** Återbetalning av deposition: bank för återbetalt, kvarhållet till intäkt */
export function depositReturnLines(o: { deposit: number; retained: number; bank: number }): { account: number; amount: number }[] {
  if (o.retained < 0 || o.retained > o.deposit) throw new Error('Kvarhållet belopp kan inte vara större än depositionen');
  const l = [{ account: DEPOSIT_ACCOUNT, amount: o.deposit }];
  if (o.deposit - o.retained) l.push({ account: o.bank, amount: -(o.deposit - o.retained) });
  if (o.retained) l.push({ account: RETAINED_DEPOSIT_ACCOUNT, amount: -o.retained });
  return l;
}

/** Vanliga komponenter för en byggnad (andel av byggnadens värde, nyttjandeperiod i år) */
export const DEFAULT_COMPONENTS: { name: string; pct: number; years: number }[] = [
  { name: 'Stomme och grund', pct: 50, years: 100 },
  { name: 'Tak', pct: 8, years: 40 },
  { name: 'Fasad och fönster', pct: 12, years: 50 },
  { name: 'Installationer (värme, el, VVS)', pct: 20, years: 40 },
  { name: 'Hiss och övriga inre ytskikt', pct: 10, years: 25 },
];

/** Fördelar anskaffningsvärdet på mark och komponenter. Komponenternas andelar ska summera till 100 %. Avrundningsdiff läggs på den största komponenten. */
export function splitComponents(cost: number, land: number, comps: { name: string; pct: number; years: number }[]) {
  if (land < 0 || land >= cost) throw new Error('Markvärdet ska vara mindre än anskaffningsvärdet');
  const sum = comps.reduce((s, c) => s + c.pct, 0);
  if (Math.abs(sum - 100) > 0.001) throw new Error(`Komponenternas andelar ska summera till 100 % (nu ${sum} %)`);
  if (comps.some((c) => c.pct <= 0 || c.years < 1 || c.years > 100)) throw new Error('Varje komponent ska ha en andel och en nyttjandeperiod på 1–100 år');
  const building = cost - land;
  const out = comps.map((c) => ({ ...c, cost: Math.round((building * c.pct) / 100), lifeMonths: c.years * 12 }));
  const diff = building - out.reduce((s, c) => s + c.cost, 0);
  out.reduce((a, b) => (b.cost > a.cost ? b : a)).cost += diff;
  return { building, land, components: out, yearlyDepreciation: out.reduce((s, c) => s + Math.round(c.cost / c.years), 0) };
}
