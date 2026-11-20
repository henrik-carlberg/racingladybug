// Kontroller innan något bokförs (rena funktioner, körs i formuläret medan man fyller i)
import { vatRateOf } from './coding-memory';

export interface Check { level: 'error' | 'warn' | 'info'; text: string }
export interface Period { lockedUntil: string | null; fiscalYears: { start: string; end: string; closed: boolean }[]; vatDeclared?: { from: string; to: string }[] }
export interface SupplierHistory { count: number; median: number; numbers: string[]; recent: { date: string; total: number }[] }

const krs = (o: number) => (o / 100).toLocaleString('sv-SE', { maximumFractionDigits: 0 }) + ' kr';
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10);
const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400_000;

/** Konton som normalt saknar moms: försäkringar, bankavgifter, personal och finansiella poster */
export function usuallyNoVat(account: number) {
  return (account >= 6310 && account <= 6399) || (account >= 6570 && account <= 6579) || (account >= 7000 && account <= 8999);
}

/** Datumet: låst period, saknat eller stängt räkenskapsår, långt fram eller långt bak i tiden */
export function dateChecks(date: string, p: Period, today: string): Check[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  const out: Check[] = [];
  if (p.lockedUntil && date <= p.lockedUntil) out.push({ level: 'error', text: `Datumet ligger i en låst period (till och med ${p.lockedUntil}) och kan inte bokföras.` });
  const fy = p.fiscalYears.find((f) => date >= f.start && date <= f.end);
  if (!fy) out.push({ level: 'error', text: 'Det finns inget räkenskapsår för datumet. Lägg upp det under Inställningar eller kontrollera datumet.' });
  else if (fy.closed) out.push({ level: 'error', text: `Räkenskapsåret ${fy.start} – ${fy.end} är avslutat.` });
  const vp = p.vatDeclared?.find((x) => date >= x.from && date <= x.to);
  if (vp && !(p.lockedUntil && date <= p.lockedUntil)) out.push({ level: 'warn', text: `Momsen för ${vp.from} – ${vp.to} är redan deklarerad. Påverkar verifikationen momsen behöver deklarationen rättas (Momsrapporten visar rättelsen).` });
  if (date > addDays(today, 30)) out.push({ level: 'warn', text: 'Datumet ligger mer än en månad fram i tiden. Stämmer det?' });
  else if (date < addDays(today, -365)) out.push({ level: 'warn', text: 'Datumet är mer än ett år gammalt. Stämmer det?' });
  return out;
}

export function supplierInvoiceChecks(i: { total: number; vat: number; account: number | null; invoiceDate: string; invoiceNumber: string; today: string; period: Period; history?: SupplierHistory | null }): Check[] {
  const out = dateChecks(i.invoiceDate, i.period, i.today);
  const h = i.history;
  if (h && i.invoiceNumber && h.numbers.includes(i.invoiceNumber.trim())) out.push({ level: 'error', text: 'Fakturanumret är redan registrerat för leverantören.' });
  if (h && i.total > 0) {
    const same = h.recent.find((r) => r.total === i.total && days(r.date, i.invoiceDate) <= 45);
    if (same) out.push({ level: 'warn', text: `En faktura på samma belopp registrerades ${same.date}. Kontrollera att det inte är samma faktura en gång till.` });
    if (h.count >= 3 && i.total > 3 * h.median && i.total - h.median > 100000) out.push({ level: 'warn', text: `Beloppet är ovanligt högt för leverantören – fakturorna brukar ligga runt ${krs(h.median)}.` });
  }
  if (i.total > 0 && i.vat > 0) {
    if (i.account && usuallyNoVat(i.account)) out.push({ level: 'warn', text: `Konto ${i.account} har normalt ingen moms (försäkringar, bankavgifter, personal och finansiella poster). Kontrollera momsen.` });
    else if (vatRateOf(i.total, i.vat) === null) out.push({ level: 'warn', text: `Momsen är ${Math.round((i.vat / (i.total - i.vat)) * 1000) / 10} % av beloppet utan moms. Normalt är den 25, 12 eller 6 %.` });
  }
  if (i.total > 0 && i.vat === 0 && i.account && i.account >= 4000 && i.account <= 6999 && !usuallyNoVat(i.account)) {
    out.push({ level: 'info', text: 'Ingen moms är angiven. Det stämmer för t.ex. utländska leverantörer och momsfria tjänster – annars fyll i momsen.' });
  }
  if (i.vat > i.total / 2 && i.total > 0) out.push({ level: 'error', text: 'Momsen kan inte vara mer än halva beloppet.' });
  return out;
}

export function voucherChecks(v: { date: string; lines: { account: number; debit: number; credit: number }[]; today: string; period: Period }): Check[] {
  const out = dateChecks(v.date, v.period, v.today);
  const sum = (f: (l: (typeof v.lines)[number]) => boolean, k: 'debit' | 'credit') => v.lines.filter(f).reduce((s, l) => s + l[k], 0);
  const inVat = sum((l) => l.account >= 2640 && l.account <= 2649, 'debit');
  const costs = sum((l) => l.account >= 4000 && l.account <= 7999, 'debit');
  if (inVat > 0 && costs > 0 && vatRateOf(costs + inVat, inVat) === null) {
    out.push({ level: 'warn', text: `Ingående moms är ${Math.round((inVat / costs) * 1000) / 10} % av kostnaden. Normalt är den 25, 12 eller 6 %.` });
  }
  const outVat = sum((l) => l.account >= 2610 && l.account <= 2639, 'credit');
  const sales = sum((l) => l.account >= 3000 && l.account <= 3999, 'credit');
  if (outVat > 0 && sales > 0 && vatRateOf(sales + outVat, outVat) === null) {
    out.push({ level: 'warn', text: `Utgående moms är ${Math.round((outVat / sales) * 1000) / 10} % av försäljningen. Normalt är den 25, 12 eller 6 %.` });
  }
  const noVatWithVat = v.lines.find((l) => l.debit > 0 && usuallyNoVat(l.account)) && inVat > 0 && costs > 0 && v.lines.every((l) => !(l.debit > 0 && l.account >= 4000 && l.account <= 6999 && !usuallyNoVat(l.account)));
  if (noVatWithVat) out.push({ level: 'warn', text: 'Kontona i verifikationen har normalt ingen moms, men ingående moms är bokförd. Kontrollera.' });
  const total = sum(() => true, 'debit');
  if (total >= 100_000_000) out.push({ level: 'info', text: `Stort belopp (${krs(total)}). Kontrollera att decimalerna stämmer.` });
  return out;
}
