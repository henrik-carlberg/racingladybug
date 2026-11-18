import { lastDay } from './assets';
// EU-handel: periodisk sammanställning och OSS – ren logik (testbar)
export const EU_COUNTRIES = ['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SI', 'SK'] as const;
export const isEu = (c: string) => (EU_COUNTRIES as readonly string[]).includes(c.toUpperCase());
/** Konton för momsfri försäljning till andra EU-länder (BAS) */
export const EU_GOODS_ACCOUNTS = [3106, 3108];
export const EU_SERVICE_ACCOUNTS = [3308];
/** Gemensam tröskel för distansförsäljning och e-tjänster till privatpersoner i EU (10 000 euro) */
export const OSS_THRESHOLD = 9_968_000;

export interface EuLine { vatNumber: string; country: string; customer: string; account: number; amountSek: number; consumer: boolean }

/** Periodisk sammanställning: summa varor och tjänster per köparens momsregistreringsnummer (hela kronor) */
export function periodicSummary(lines: EuLine[]) {
  const by = new Map<string, { vatNumber: string; customer: string; goods: number; services: number }>();
  const missing: string[] = [];
  for (const l of lines) {
    const goods = EU_GOODS_ACCOUNTS.includes(l.account), services = EU_SERVICE_ACCOUNTS.includes(l.account);
    if (!goods && !services) continue;
    if (!l.vatNumber) { if (!missing.includes(l.customer)) missing.push(l.customer); continue; }
    const k = l.vatNumber.toUpperCase().replace(/\s/g, '');
    const e = by.get(k) ?? { vatNumber: k, customer: l.customer, goods: 0, services: 0 };
    if (goods) e.goods += l.amountSek; else e.services += l.amountSek;
    by.set(k, e);
  }
  const rows = [...by.values()].map((r) => ({ ...r, goods: Math.round(r.goods / 100), services: Math.round(r.services / 100) }))
    .filter((r) => r.goods || r.services).sort((a, b) => a.vatNumber.localeCompare(b.vatNumber));
  return { rows, missing, totalGoods: rows.reduce((s, r) => s + r.goods, 0), totalServices: rows.reduce((s, r) => s + r.services, 0) };
}

/** OSS: försäljning till privatpersoner i andra EU-länder per land, och om tröskeln är passerad */
export function ossSummary(lines: EuLine[]) {
  const by = new Map<string, number>();
  for (const l of lines) if (l.consumer && isEu(l.country) && l.country.toUpperCase() !== 'SE') by.set(l.country.toUpperCase(), (by.get(l.country.toUpperCase()) ?? 0) + l.amountSek);
  const rows = [...by.entries()].map(([country, net]) => ({ country, net })).sort((a, b) => b.net - a.net);
  const total = rows.reduce((s, r) => s + r.net, 0);
  return { rows, total, overThreshold: total > OSS_THRESHOLD };
}

/** CSV (semikolon) för att föra över sammanställningen, en rad per köpare */
export function periodicSummaryCsv(o: { vatNumber: string; period: string; rows: { vatNumber: string; goods: number; services: number }[] }) {
  return ['Säljarens momsreg.nr;Period;Köparens momsreg.nr;Varor (kr);Trepartshandel (kr);Tjänster (kr)',
    ...o.rows.map((r) => [o.vatNumber, o.period, r.vatNumber, r.goods, 0, r.services].join(';'))].join('\r\n') + '\r\n';
}

/** Perioden som väljs: ÅÅÅÅ-MM eller ÅÅÅÅ-Qn */
export function periodRange(p: string): { from: string; to: string; label: string } | null {
  let m = p.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (m) return { from: `${p}-01`, to: lastDay(p), label: p };
  m = p.match(/^(\d{4})-Q([1-4])$/);
  if (m) { const q = Number(m[2]); const a = `${m[1]}-${String(q * 3 - 2).padStart(2, '0')}`, b = `${m[1]}-${String(q * 3).padStart(2, '0')}`; return { from: `${a}-01`, to: lastDay(b), label: `${m[1]} kvartal ${q}` }; }
  return null;
}

