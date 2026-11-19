// Moms för e-handel inom EU: OSS (unionsordningen) och periodisk sammanställning i Skatteverkets filformat. Ren logik, öre.
import { isEu } from './eu';

/** Normalskattesatser per land (procent) – kontrollera aktuella satser hos EU-kommissionen innan varje kvartal */
export const OSS_RATES: Record<string, number> = {
  AT: 20, BE: 21, BG: 20, CY: 19, CZ: 21, DE: 19, DK: 25, EE: 24, ES: 21, FI: 25.5, FR: 20, GR: 24, HR: 25, HU: 27, IE: 23, IT: 22,
  LT: 21, LU: 17, LV: 21, MT: 18, NL: 21, PL: 23, PT: 23, RO: 21, SI: 22, SK: 23,
};
export const OSS_SALES_ACCOUNT = 3109;   // Försäljning till privatpersoner i andra EU-länder (OSS)
export const OSS_VAT_ACCOUNT = 2670;     // Utgående moms OSS – redovisas i OSS-deklarationen, inte i den svenska momsdeklarationen

/** Säljs till en privatperson i ett annat EU-land av ett bolag som är registrerat för OSS? */
export function ossCountry(o: { registered: boolean; country: string; vatNumber: string; reverseCharge: boolean }) {
  const c = (o.country || 'SE').toUpperCase();
  return o.registered && !o.reverseCharge && !o.vatNumber.trim() && c !== 'SE' && isEu(c) && OSS_RATES[c] != null ? c : null;
}

/** Kvartalets deklaration: per land och skattesats, belopp i euro anges av Skatteverkets e-tjänst – här i kronor */
export function ossDeclaration(lines: { country: string; rate: number; base: number; vat: number }[]) {
  const by = new Map<string, { country: string; rate: number; base: number; vat: number }>();
  for (const l of lines) {
    const k = `${l.country}:${l.rate}`;
    const e = by.get(k) ?? { country: l.country, rate: l.rate, base: 0, vat: 0 };
    e.base += l.base; e.vat += l.vat; by.set(k, e);
  }
  const rows = [...by.values()].sort((a, b) => a.country.localeCompare(b.country) || b.rate - a.rate);
  return { rows, base: rows.reduce((s, r) => s + r.base, 0), vat: rows.reduce((s, r) => s + r.vat, 0) };
}

/** OSS-deklarationen lämnas och betalas senast sista dagen i månaden efter kvartalet */
export function ossDue(year: number, quarter: number) {
  const m = quarter * 3 + 1, y = m > 12 ? year + 1 : year, mm = m > 12 ? 1 : m;
  return new Date(Date.UTC(y, mm, 0)).toISOString().slice(0, 10);
}

/**
 * Periodisk sammanställning som fil till Skatteverkets e-tjänst (SKV574008):
 * rad 1 "SKV574008;", rad 2 säljarens momsreg.nr;period;kontaktperson;telefon;e-post, sedan köparens momsreg.nr;varor;trepartshandel;tjänster (hela kronor).
 * Period: ÅÅMM för månad, ÅÅ-K för kvartal.
 */
export function psSkvFile(o: { vatNumber: string; period: string; contact: string; phone: string; email: string; rows: { vatNumber: string; goods: number; services: number }[] }) {
  const m = /^(\d{4})-(?:(\d{2})|Q([1-4]))$/.exec(o.period);
  if (!m) throw new Error('Ogiltig period');
  const p = m[2] ? `${m[1].slice(2)}${m[2]}` : `${m[1].slice(2)}-${m[3]}`;
  const clean = (s: string) => s.replace(/[;\r\n]/g, ' ').trim();
  return ['SKV574008;', `${o.vatNumber.replace(/\s/g, '').toUpperCase()};${p};${clean(o.contact)};${clean(o.phone)};${clean(o.email)}`,
    ...o.rows.map((r) => `${r.vatNumber};${r.goods || ''};;${r.services || ''}`)].join('\r\n') + '\r\n';
}
