// Bedrägeri- och felskydd: dubbletter, ändrade bankuppgifter och ovanliga transaktioner. Ren logik, belopp i öre.

export const BANK_FIELDS = ['bankgiro', 'plusgiro', 'bank_account'] as const;
export type BankField = typeof BANK_FIELDS[number];
const norm = (s: string) => s.replace(/[\s-]/g, '');

/**
 * Ändrade bankuppgifter jämfört med tidigare. Har leverantören redan någon betalningsuppgift räknas varje ändring
 * – även ett nytt bankgiro i ett tomt fält, eftersom bankgiro går före plusgiro och konto vid betalning.
 * En leverantör utan några bankuppgifter alls får dem utan godkännande (första registreringen).
 */
export function bankChanges(old: Record<BankField, string>, next: Partial<Record<BankField, unknown>>) {
  const out: Partial<Record<BankField, string>> = {};
  if (!BANK_FIELDS.some((f) => norm(old[f] ?? '') !== '')) return out;
  for (const f of BANK_FIELDS) {
    if (next[f] === undefined) continue;
    const v = String(next[f] ?? '').trim();
    if (norm(v) !== norm(old[f] ?? '')) out[f] = v;
  }
  return out;
}

/** Fakturanummer för jämförelse: bara bokstäver och siffror, utan inledande nollor */
export const normInvoiceNo = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+(?=.)/, '');

export interface SI { id: number; supplierId: number; number: string; date: string; total: number; reference: string }
const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;

/** Möjlig dubblett av en tidigare faktura – och varför */
export function duplicateOf(n: SI, earlier: SI[]): { id: number; reason: string } | null {
  for (const e of earlier) {
    if (e.id === n.id) continue;
    if (e.supplierId === n.supplierId && normInvoiceNo(e.number) === normInvoiceNo(n.number) && normInvoiceNo(n.number)) return { id: e.id, reason: 'samma fakturanummer' };
    if (n.reference && norm(e.reference) === norm(n.reference) && e.total === n.total) return { id: e.id, reason: 'samma OCR och belopp' };
    if (e.supplierId === n.supplierId && e.total === n.total && days(e.date, n.date) <= 7) return { id: e.id, reason: 'samma belopp och nästan samma datum' };
  }
  return null;
}

export interface Out { id: number; date: string; amount: number; counterparty: string }
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const key = (s: string) => s.toLowerCase().replace(/[^a-zåäö0-9]/g, '').slice(0, 20);

/** Ovanliga utbetalningar: mycket större än vanligt till samma mottagare, eller ett större belopp till en ny mottagare */
export function unusualPayments(rows: Out[], opts = { newRecipientMin: 1000000, factor: 3 }) {
  const out: { id: number; kind: 'large' | 'new_recipient'; detail: string }[] = [];
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const seen = new Map<string, number[]>();
  for (const r of sorted) {
    const k = key(r.counterparty), amt = Math.abs(r.amount);
    const prev = seen.get(k) ?? [];
    if (k && prev.length >= 3 && amt > opts.factor * median(prev)) out.push({ id: r.id, kind: 'large', detail: `${Math.round(amt / median(prev))} gånger det vanliga beloppet till ${r.counterparty}` });
    else if (k && prev.length === 0 && amt >= opts.newRecipientMin && sorted.some((x) => x.date < r.date)) out.push({ id: r.id, kind: 'new_recipient', detail: `Första betalningen till ${r.counterparty}` });
    seen.set(k, [...prev, amt]);
  }
  return out;
}

/** Lördag eller söndag (svensk tid) */
export const isWeekend = (d: Date) => { const w = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Stockholm' })).getDay(); return w === 0 || w === 6; };
