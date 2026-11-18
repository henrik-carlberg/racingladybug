// Nyckeltal – ren logik (testbar). Saldon som debet − kredit (öre).
import { sumRange } from './monthly';

export interface Kpi { key: string; label: string; value: number | null; unit: '%' | 'dagar'; status: 'good' | 'warning' | 'serious' | null; explain: string }

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);

/** Nyckeltal från balans (vid dagens datum) och resultat hittills i år */
export function kpis(o: { balance: Map<number, number>; result: Map<number, number>; avgPayDays: number | null }): Kpi[] {
  const b = o.balance, r = o.result;
  const assets = sumRange(b, 1000, 1999);
  const equity = -sumRange(b, 2000, 2099) + Math.round(-sumRange(b, 2100, 2199) * 0.794); // justerat eget kapital: 79,4 % av obeskattade reserver
  const current = sumRange(b, 1500, 1999); // omsättningstillgångar exkl. varulager
  const shortDebt = -sumRange(b, 2400, 2999);
  const revenue = -sumRange(r, 3000, 3999);
  const goods = sumRange(r, 4000, 4999);
  const operating = -sumRange(r, 3000, 7999);
  const sol = pct(equity, assets), liq = pct(current, shortDebt), gross = pct(revenue - goods, revenue), op = pct(operating, revenue);
  const st = (v: number | null, good: number, warn: number) => (v == null ? null : v >= good ? 'good' : v >= warn ? 'warning' : 'serious');
  return [
    { key: 'solidity', label: 'Soliditet', value: sol, unit: '%', status: st(sol, 30, 15), explain: 'Justerat eget kapital i procent av tillgångarna. Visar hur mycket av bolaget som ägs av ägarna – över 30 % brukar räknas som stabilt.' },
    { key: 'quick', label: 'Kassalikviditet', value: liq, unit: '%', status: st(liq, 100, 75), explain: 'Kassa, bank och fordringar i procent av de kortfristiga skulderna. Under 100 % kan bolaget få svårt att betala sina räkningar i tid.' },
    { key: 'gross', label: 'Bruttomarginal', value: gross, unit: '%', status: null, explain: 'Intäkter minus varor och material, i procent av intäkterna, hittills i år. Jämför med tidigare år och branschen.' },
    { key: 'operating', label: 'Rörelsemarginal', value: op, unit: '%', status: st(op, 10, 0), explain: 'Rörelseresultat (före finansiella poster och skatt) i procent av intäkterna, hittills i år.' },
    { key: 'paydays', label: 'Kundernas betaltid', value: o.avgPayDays, unit: 'dagar', status: o.avgPayDays == null ? null : o.avgPayDays <= 30 ? 'good' : o.avgPayDays <= 45 ? 'warning' : 'serious', explain: 'Genomsnittligt antal dagar från fakturadatum till betalning, de senaste 12 månaderna.' },
  ];
}

/** Fakturor per betaltid i dagar */
export const PAY_BINS = [[0, 10], [11, 20], [21, 30], [31, 45], [46, 60], [61, 9999]] as const;
export function payBins(days: number[]) {
  return PAY_BINS.map(([a, b]) => ({ label: b > 999 ? `>${a - 1}` : `${a}–${b}`, count: days.filter((d) => d >= a && d <= b).length }));
}
