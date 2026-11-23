// Bonus i efterhand med trappsteg: den högsta nivå som volymen når gäller på hela volymen. Belopp i öre, procent i hundradelar.
export const CUSTOMER_REBATE_ACCOUNT = 3730; // Lämnade rabatter
export const CUSTOMER_ACCRUAL_ACCOUNT = 2990; // Övriga upplupna kostnader och förutbetalda intäkter
export const SUPPLIER_REBATE_ACCOUNT = 4730; // Erhållna rabatter
export const SUPPLIER_ACCRUAL_ACCOUNT = 1790; // Övriga förutbetalda kostnader och upplupna intäkter

export interface Tier { from: number; pct: number }

/** "500000:2, 1000000:3" → trappsteg (kronor från och med : procent) */
export function parseTiers(s: string): Tier[] {
  const parts = s.split(/[;\n]|,\s+/).map((x) => x.trim()).filter(Boolean);
  const tiers = parts.map((p) => {
    const m = p.replace(/\s/g, '').match(/^(\d+(?:[.,]\d+)?):(\d+(?:[.,]\d+)?)%?$/);
    if (!m) throw new Error(`Ogiltigt trappsteg "${p}" – skriv t.ex. 500000:2`);
    const from = Math.round(Number(m[1].replace(',', '.')) * 100), pct = Math.round(Number(m[2].replace(',', '.')) * 100);
    if (pct <= 0 || pct > 5000) throw new Error('Bonusen ska vara mellan 0 och 50 %');
    return { from, pct };
  }).sort((a, b) => a.from - b.from);
  if (!tiers.length) throw new Error('Ange minst ett trappsteg');
  if (new Set(tiers.map((t) => t.from)).size !== tiers.length) throw new Error('Två trappsteg har samma gräns');
  return tiers;
}

export const tierFor = (volume: number, tiers: Tier[]) => [...tiers].reverse().find((t) => volume >= t.from) ?? null;

/** Bonus på volymen (exkl. moms) och nästa trappsteg */
export function rebate(volume: number, tiers: Tier[]) {
  const t = tierFor(volume, tiers);
  const next = tiers.find((x) => x.from > volume) ?? null;
  return { pct: t?.pct ?? 0, amount: t ? Math.round((Math.max(0, volume) * t.pct) / 10000) : 0, next, toNext: next ? next.from - volume : 0 };
}

export const tiersText = (tiers: Tier[]) => tiers.map((t) => `${(t.from / 100).toLocaleString('sv-SE')} kr: ${(t.pct / 100).toLocaleString('sv-SE')} %`).join(', ');

/** Upplupen kundbonus: debet 3730, kredit 2990 (ändring mot tidigare upplupet) */
export const customerAccrualLines = (change: number) => [{ account: CUSTOMER_REBATE_ACCOUNT, amount: change }, { account: CUSTOMER_ACCRUAL_ACCOUNT, amount: -change }];
/** Upplupen leverantörsbonus: debet 1790, kredit 4730 */
export const supplierAccrualLines = (change: number) => [{ account: SUPPLIER_ACCRUAL_ACCOUNT, amount: change }, { account: SUPPLIER_REBATE_ACCOUNT, amount: -change }];

/** Mottagen leverantörsbonus: debet bank/leverantörsskuld inkl. moms, kredit 2641 (ingående moms minskar), kredit 1790 (det upplupna) och 4730 för skillnaden */
export function supplierSettlementLines(amount: number, vat: number, accrued: number, method: 'bank' | 'credit') {
  return [
    { account: method === 'bank' ? 1930 : 2440, amount: amount + vat },
    { account: 2641, amount: -vat },
    { account: SUPPLIER_ACCRUAL_ACCOUNT, amount: -accrued },
    { account: SUPPLIER_REBATE_ACCOUNT, amount: -(amount - accrued) },
  ].filter((l) => l.amount !== 0);
}
