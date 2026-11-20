// Kontrollbalansräkning och tvångslikvidation (aktiebolagslagen 25 kap. 13–20 §§). Belopp i öre, saldo = debet − kredit.
export const TAX_RATE = 0.206;

const sum = (m: Map<number, number>, p: (n: number) => boolean) => { let s = 0; for (const [n, v] of m) if (p(n)) s += v; return s; };

/** Eget kapital och aktiekapital ur balanserna (årets ej bokslutade resultat räknas med) */
export function equityFromBalances(balances: Map<number, number>) {
  const shareCapital = -sum(balances, (n) => n === 2081 || n === 2082);
  const result = -sum(balances, (n) => n >= 3000 && n <= 8999);
  const equity = -sum(balances, (n) => n >= 2080 && n <= 2099) + result;
  const untaxed = -sum(balances, (n) => n >= 2110 && n <= 2199);
  return { shareCapital, equity, untaxed, result };
}

export interface Adjustment { label: string; amount: number }
/**
 * Kontrollbalansräkningens eget kapital: bokfört eget kapital, obeskattade reserver efter skatt (79,4 %) och
 * justeringar till verkligt värde (t.ex. övervärden i fastigheter). Kapitalbrist när det understiger halva aktiekapitalet.
 */
export function controlBalance(i: { shareCapital: number; equity: number; untaxed: number; adjustments: Adjustment[] }) {
  const reserves = Math.round(i.untaxed * (1 - TAX_RATE));
  const adj = i.adjustments.reduce((s, a) => s + a.amount, 0);
  const equity = i.equity + reserves + adj;
  const half = Math.round(i.shareCapital / 2);
  return { reserves, adjustments: adj, equity, half, deficit: equity < half, restored: equity >= i.shareCapital, shortfall: Math.max(0, i.shareCapital - equity) };
}

/** Samma dag m månader senare; finns dagen inte i månaden blir det månadens sista dag */
export const addMonths = (d: string, m: number) => {
  const [y, mo, day] = d.split('-').map(Number);
  const last = new Date(Date.UTC(y, mo - 1 + m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, mo - 1 + m, Math.min(day, last))).toISOString().slice(0, 10);
};

/** Tidsfrister: första kontrollstämman snarast, den andra inom åtta månader från den första; annars ska styrelsen ansöka om likvidation */
export function deadlines(firstMeeting: string | null) {
  return firstMeeting ? { second: addMonths(firstMeeting, 8) } : { second: null };
}

/** Snabbtest på det bokförda (utan omvärderingar) – grund för varningen i appen */
export function warning(balances: Map<number, number>) {
  const e = equityFromBalances(balances);
  if (e.shareCapital <= 0) return null;
  const c = controlBalance({ ...e, adjustments: [] });
  return c.deficit ? { ...e, ...c } : null;
}

/** Skifte vid likvidation: nettotillgångarna fördelas efter ägarandel (öre som blir över går till den största ägaren) */
export function distribution(net: number, owners: { name: string; pct: number }[]) {
  const total = owners.reduce((s, o) => s + o.pct, 0);
  if (!total || net <= 0) return owners.map((o) => ({ ...o, amount: 0 }));
  const rows = owners.map((o) => ({ ...o, amount: Math.floor((net * o.pct) / total) }));
  const rest = net - rows.reduce((s, r) => s + r.amount, 0);
  if (rest) rows.reduce((a, b) => (b.pct > a.pct ? b : a)).amount += rest;
  return rows;
}

export function parseAdjustments(text: string): Adjustment[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = /^(.+?)[;:\t]\s*(-?[\d\s.,]+)$/.exec(l);
    if (!m) throw new Error(`Skriv justeringen som "beskrivning; belopp" (rad: ${l})`);
    const n = Math.round(Number(m[2].replace(/[\s.]/g, '').replace(',', '.')) * 100);
    if (!Number.isFinite(n)) throw new Error(`Ogiltigt belopp på raden: ${l}`);
    return { label: m[1].trim().slice(0, 200), amount: n };
  });
}
