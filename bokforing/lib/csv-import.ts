// Import från CSV (t.ex. export från Fortnox eller Visma) – ren logik (testbar)
import { parseAmount } from './money';

export type ImportKind = 'customers' | 'suppliers' | 'articles' | 'customer_invoices' | 'supplier_invoices';

/** Avkodar en fil: UTF-8 om det går, annars Windows-1252 (vanligt i äldre exporter) */
export function decodeCsv(buf: Uint8Array): string {
  let s = new TextDecoder('utf-8').decode(buf);
  if (s.includes('�')) s = new TextDecoder('windows-1252').decode(buf);
  return s.replace(/^﻿/, '');
}

/** CSV med automatisk avgränsare (; , eller tabb), citattecken och radbrytningar i fält */
export function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = [';', '\t', ','].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"' && cur === '') q = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-zåäö0-9]/g, '');

/** Kolumnnamn som känns igen per fält (normaliserade: gemener utan mellanslag och skiljetecken) */
const ALIASES: Record<ImportKind, Record<string, string[]>> = {
  customers: {
    name: ['namn', 'kundnamn', 'name', 'företag', 'foretag', 'företagsnamn'], orgnr: ['organisationsnummer', 'orgnr', 'organisationsnr', 'personnummerorgnr', 'orgnrpersonnr'],
    vat_number: ['momsnummer', 'momsregnr', 'vatnummer', 'vatnr', 'momsregistreringsnummer'], email: ['epost', 'email', 'mejl', 'fakturaepost', 'epostfaktura'],
    address: ['adress', 'address', 'utdelningsadress', 'fakturaadress', 'gatuadress'], postal_code: ['postnummer', 'postnr', 'zip'], city: ['ort', 'postort', 'city', 'stad'],
    country: ['land', 'landskod', 'country'], payment_terms: ['betalningsvillkor', 'betvillkor', 'villkor', 'kredittid', 'betalvillkor'],
  },
  suppliers: {
    name: ['namn', 'leverantörsnamn', 'leverantor', 'leverantör', 'name', 'företag'], orgnr: ['organisationsnummer', 'orgnr', 'organisationsnr'],
    bankgiro: ['bankgiro', 'bg', 'bankgironummer'], plusgiro: ['plusgiro', 'pg', 'postgiro'], bank_account: ['bankkonto', 'kontonummer', 'clearingochkonto'],
    email: ['epost', 'email', 'mejl'], default_account: ['konto', 'kostnadskonto', 'förvalt konto', 'forvaltkonto', 'standardkonto'],
  },
  articles: {
    sku: ['artikelnummer', 'artnr', 'sku', 'artikelnr', 'nummer'], name: ['benämning', 'benamning', 'namn', 'beskrivning', 'artikel', 'name'],
    unit: ['enhet', 'unit'], sales_price: ['försäljningspris', 'forsaljningspris', 'pris', 'àpris', 'apris', 'utpris', 'pris exkl moms'],
    purchase_price: ['inköpspris', 'inkopspris', 'inpris'], vat_rate: ['moms', 'momssats', 'momsprocent', 'vat'],
  },
  customer_invoices: {
    number: ['fakturanummer', 'fakturanr', 'nr', 'nummer', 'invoicenumber'], customer: ['kund', 'kundnamn', 'namn', 'customer'],
    orgnr: ['organisationsnummer', 'orgnr'], invoice_date: ['fakturadatum', 'datum', 'date'], due_date: ['förfallodatum', 'forfallodatum', 'förfallodag', 'duedate', 'förfaller'],
    amount: ['restbelopp', 'kvaratt betala', 'kvarattbetala', 'saldo', 'obetalt', 'belopp', 'totalt', 'total', 'summa', 'attbetala'], ocr: ['ocr', 'ocrnummer'],
  },
  supplier_invoices: {
    number: ['fakturanummer', 'fakturanr', 'nr', 'nummer'], supplier: ['leverantör', 'leverantor', 'leverantörsnamn', 'namn'],
    orgnr: ['organisationsnummer', 'orgnr'], invoice_date: ['fakturadatum', 'datum'], due_date: ['förfallodatum', 'forfallodatum', 'förfallodag', 'förfaller'],
    amount: ['restbelopp', 'kvarattbetala', 'saldo', 'obetalt', 'belopp', 'totalt', 'total', 'summa', 'attbetala'], reference: ['ocr', 'betalningsreferens', 'referens', 'meddelande'],
  },
};
// Normalisera aliasen en gång
for (const k of Object.values(ALIASES)) for (const f of Object.keys(k)) k[f] = k[f].map(norm);

export const REQUIRED: Record<ImportKind, string[]> = {
  customers: ['name'], suppliers: ['name'], articles: ['sku', 'name'],
  customer_invoices: ['number', 'customer', 'invoice_date', 'due_date', 'amount'],
  supplier_invoices: ['number', 'supplier', 'invoice_date', 'due_date', 'amount'],
};

export const KIND_LABEL: Record<ImportKind, string> = {
  customers: 'Kunder', suppliers: 'Leverantörer', articles: 'Artiklar', customer_invoices: 'Obetalda kundfakturor', supplier_invoices: 'Obetalda leverantörsfakturor',
};

/** Vilket fält varje kolumn motsvarar (index → fält) */
export function mapColumns(kind: ImportKind, header: string[]): Map<number, string> {
  const m = new Map<number, string>();
  const used = new Set<string>();
  const a = ALIASES[kind];
  const n = header.map(norm);
  // Exakta träffar först, i aliasens ordning (så att "Restbelopp" väljs före "Total")
  for (const [f, al] of Object.entries(a)) {
    for (const x of al) {
      const i = n.findIndex((h, j) => h === x && !m.has(j));
      if (i >= 0) { m.set(i, f); used.add(f); break; }
    }
  }
  // Sedan rubriker som börjar med ett alias, t.ex. "Förfallodatum (ÅÅÅÅ-MM-DD)"
  n.forEach((h, i) => {
    if (m.has(i)) return;
    for (const [f, al] of Object.entries(a)) {
      if (!used.has(f) && al.some((x) => x.length >= 4 && h.startsWith(x))) { m.set(i, f); used.add(f); return; }
    }
  });
  return m;
}

function parseDate(s: string): string | null {
  const v = s.trim();
  let m = v.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
  if (!m) { const d = v.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/); if (d) m = [v, d[3], d[2].padStart(2, '0'), d[1].padStart(2, '0')]; }
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const t = new Date(iso + 'T00:00:00Z');
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === iso ? iso : null;
}

export interface ImportPreview { kind: ImportKind; columns: { header: string; field: string | null }[]; rows: Record<string, string | number | null>[]; errors: { row: number; message: string }[]; missing: string[] }

/** Tolkar och validerar en CSV-fil för en typ av import. Raderna är klara att spara (belopp i öre, datum ÅÅÅÅ-MM-DD). */
export function previewImport(kind: ImportKind, text: string, maxRows = 5000): ImportPreview {
  const all = parseCsv(text);
  const header = all[0] ?? [];
  const map = mapColumns(kind, header);
  const fields = new Set(map.values());
  const missing = REQUIRED[kind].filter((f) => !fields.has(f));
  const out: ImportPreview = { kind, columns: header.map((h, i) => ({ header: h, field: map.get(i) ?? null })), rows: [], errors: [], missing };
  if (missing.length) return out;
  if (all.length - 1 > maxRows) { out.errors.push({ row: 0, message: `Filen har ${all.length - 1} rader – högst ${maxRows} per import` }); return out; }
  all.slice(1).forEach((cells, idx) => {
    const rowNo = idx + 2;
    const r: Record<string, string> = {};
    map.forEach((f, i) => { r[f] = (cells[i] ?? '').trim(); });
    const err = (msg: string) => out.errors.push({ row: rowNo, message: msg });
    for (const f of REQUIRED[kind]) if (!r[f]) { err(`${f === 'name' ? 'Namn' : f} saknas`); return; }
    const o: Record<string, string | number | null> = { ...r };
    if (kind === 'customers') {
      o.payment_terms = r.payment_terms ? Number(r.payment_terms.match(/\d+/)?.[0]) || null : null;
      o.country = (r.country || 'SE').toUpperCase().slice(0, 2) === 'SV' ? 'SE' : (r.country || 'SE').toUpperCase().slice(0, 2);
    }
    if (kind === 'suppliers') {
      const acc = r.default_account ? Number(r.default_account) : 4010;
      if (!Number.isInteger(acc) || acc < 1000 || acc > 8999) { err(`Ogiltigt konto "${r.default_account}"`); return; }
      o.default_account = acc;
    }
    if (kind === 'articles') {
      for (const f of ['sales_price', 'purchase_price']) {
        if (!r[f]) { o[f] = 0; continue; }
        const v = parseAmount(r[f]);
        if (v == null || v < 0) { err(`Ogiltigt pris "${r[f]}"`); return; }
        o[f] = v;
      }
      const vat = r.vat_rate ? Number(r.vat_rate.replace('%', '').replace(',', '.').trim()) : 25;
      if (![0, 6, 12, 25].includes(vat)) { err(`Ogiltig momssats "${r.vat_rate}"`); return; }
      o.vat_rate = vat;
      o.unit = r.unit || 'st';
    }
    if (kind === 'customer_invoices' || kind === 'supplier_invoices') {
      for (const f of ['invoice_date', 'due_date']) {
        const d = parseDate(r[f]);
        if (!d) { err(`Ogiltigt datum "${r[f]}"`); return; }
        o[f] = d;
      }
      const v = parseAmount(r.amount);
      if (v == null || v <= 0) { err(`Ogiltigt belopp "${r.amount}"`); return; }
      o.amount = v;
      if (kind === 'customer_invoices' && !/^\d{1,9}$/.test(r.number)) { err(`Fakturanumret måste vara ett heltal ("${r.number}")`); return; }
    }
    out.rows.push(o);
  });
  return out;
}
