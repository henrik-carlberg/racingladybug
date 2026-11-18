// Tolkning av banktransaktioner från fil (camt.053 / CSV) och från Enable Banking till ett gemensamt format.
import { createHash } from 'node:crypto';
import { parseAmount } from '@/lib/money';

export interface BankTx {
  externalId: string;
  bookingDate: string; // ÅÅÅÅ-MM-DD
  amount: number; // öre, positivt = insättning
  currency: string;
  description: string;
  reference: string;
  counterparty: string;
  raw?: unknown;
}

/** Decimalsträng ("1234.50") → öre utan flyttalsfel */
export function decimalToOre(s: string): number {
  const m = String(s).trim().match(/^(-?)(\d+)(?:\.(\d{1,2}))?\d*$/);
  if (!m) throw new Error(`Ogiltigt belopp: ${s}`);
  const v = Number(m[2]) * 100 + Number(((m[3] ?? '') + '00').slice(0, 2));
  return m[1] ? -v : v;
}

/** Stabilt id för transaktioner som saknar bankreferens. n skiljer på identiska transaktioner samma dag. */
function syntheticId(t: Omit<BankTx, 'externalId'>, n: number) {
  return 'h:' + createHash('sha256').update([t.bookingDate, t.amount, t.description, t.reference, t.counterparty, n].join('|')).digest('hex').slice(0, 32);
}

function withIds(list: (Omit<BankTx, 'externalId'> & { externalId?: string })[]): BankTx[] {
  const seen = new Map<string, number>();
  return list.map((t) => {
    if (t.externalId) return t as BankTx;
    const k = [t.bookingDate, t.amount, t.description, t.reference, t.counterparty].join('|');
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return { ...t, externalId: syntheticId(t, n) };
  });
}

// ---------- ISO 20022 camt.053 (kontoutdrag) ----------

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const tag = (xml: string, path: string): string | null => {
  // path som 'BookgDt/Dt' – hittar första förekomsten av den nästlade taggen (namespace-prefix tillåts)
  let cur = xml;
  for (const t of path.split('/')) {
    const m = cur.match(new RegExp(`<(?:\\w+:)?${t}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${t}>`));
    if (!m) return null;
    cur = m[1];
  }
  return decode(cur.trim());
};
const all = (xml: string, t: string) => [...xml.matchAll(new RegExp(`<(?:\\w+:)?${t}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${t}>`, 'g'))].map((m) => m[1]);

export function parseCamt053(xml: string): { iban: string | null; transactions: BankTx[] } {
  if (!/BkToCstmrStmt|BkToCstmrAcctRpt/.test(xml)) throw new Error('Filen är inte ett camt.053/camt.052-kontoutdrag');
  const iban = tag(xml, 'Acct/Id/IBAN');
  const list = all(xml, 'Ntry').map((e) => {
    const status = tag(e, 'Sts/Cd') ?? tag(e, 'Sts');
    if (status && status !== 'BOOK') return null;
    const amtM = e.match(/<(?:\w+:)?Amt\s+Ccy="([A-Z]{3})"[^>]*>([^<]+)</);
    if (!amtM) return null;
    const credit = tag(e, 'CdtDbtInd') === 'CRDT';
    const amount = decimalToOre(amtM[2]) * (credit ? 1 : -1);
    const date = (tag(e, 'BookgDt/Dt') ?? tag(e, 'BookgDt/DtTm') ?? '').slice(0, 10);
    const ustrd = all(e, 'Ustrd').map((x) => decode(x.trim())).join(' ');
    const ref = tag(e, 'CdtrRefInf/Ref') ?? tag(e, 'EndToEndId') ?? '';
    const party = credit ? (tag(e, 'Dbtr/Pty/Nm') ?? tag(e, 'Dbtr/Nm')) : (tag(e, 'Cdtr/Pty/Nm') ?? tag(e, 'Cdtr/Nm'));
    const ext = tag(e, 'AcctSvcrRef') ?? tag(e, 'NtryRef');
    return {
      externalId: ext ? `camt:${ext}` : undefined, bookingDate: date, amount, currency: amtM[1],
      description: (ustrd || tag(e, 'AddtlNtryInf') || '').slice(0, 500), reference: ref === 'NOTPROVIDED' ? '' : ref,
      counterparty: party ?? '',
    };
  }).filter((t): t is NonNullable<typeof t> => !!t && /^\d{4}-\d{2}-\d{2}$/.test(t.bookingDate));
  return { iban, transactions: withIds(list) };
}

// ---------- CSV-export från internetbanken ----------

const DATE_COLS = ['bokföringsdag', 'bokföringsdatum', 'bokförd', 'reskontradatum', 'transaktionsdatum', 'transaktionsdag', 'datum', 'booking date', 'date'];
const AMOUNT_COLS = ['belopp', 'amount', 'belopp sek'];
const TEXT_COLS = ['text/mottagare', 'beskrivning', 'text', 'rubrik', 'transaktion', 'specifikation', 'description', 'namn'];
const REF_COLS = ['referens', 'meddelande', 'ocr', 'reference', 'message'];
const PARTY_COLS = ['avsändare', 'mottagare', 'motpart', 'counterparty'];

function splitCsv(line: string, d: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === d) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseBankCsv(text: string): BankTx[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const hIdx = lines.findIndex((l) => { const low = l.toLowerCase(); return DATE_COLS.some((c) => low.includes(c)) && AMOUNT_COLS.some((c) => low.includes(c)); });
  if (hIdx < 0) throw new Error('Hittar ingen rubrikrad med datum och belopp i CSV-filen');
  const h = lines[hIdx];
  const d = [';', '\t', ','].sort((a, b) => h.split(b).length - h.split(a).length)[0];
  const cols = splitCsv(h, d).map((c) => c.toLowerCase());
  const find = (cands: string[]) => { for (const c of cands) { const i = cols.indexOf(c); if (i >= 0) return i; } return -1; };
  const iDate = find(DATE_COLS), iAmt = find(AMOUNT_COLS), iText = find(TEXT_COLS), iRef = find(REF_COLS), iParty = find(PARTY_COLS);
  const iCur = cols.indexOf('valuta');
  if (iDate < 0 || iAmt < 0) throw new Error('CSV-filen saknar kolumn för datum eller belopp');
  const list = lines.slice(hIdx + 1).map((l, n) => {
    const v = splitCsv(l, d);
    const date = (v[iDate] ?? '').replace(/\//g, '-').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const amount = parseAmount(v[iAmt]);
    if (amount == null) throw new Error(`Rad ${hIdx + n + 2}: ogiltigt belopp "${v[iAmt]}"`);
    return {
      bookingDate: date, amount, currency: iCur >= 0 && /^[A-Z]{3}$/.test(v[iCur]) ? v[iCur] : 'SEK',
      description: iText >= 0 ? v[iText] : '', reference: iRef >= 0 && iRef !== iText ? v[iRef] : '',
      counterparty: iParty >= 0 && iParty !== iText ? v[iParty] : '',
    };
  }).filter((t): t is NonNullable<typeof t> => !!t);
  return withIds(list);
}

// ---------- Enable Banking ----------

export interface EbTransaction {
  entry_reference?: string | null;
  transaction_id?: string | null;
  transaction_amount: { amount: string; currency: string };
  credit_debit_indicator: 'CRDT' | 'DBIT';
  status: string;
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  creditor?: { name?: string | null } | null;
  debtor?: { name?: string | null } | null;
  remittance_information?: string[] | null;
  reference_number?: string | null;
  note?: string | null;
}

export function fromEnableBanking(list: EbTransaction[]): BankTx[] {
  return withIds(list.filter((t) => t.status === 'BOOK').map((t) => {
    const credit = t.credit_debit_indicator === 'CRDT';
    const amount = Math.abs(decimalToOre(t.transaction_amount.amount)) * (credit ? 1 : -1);
    const date = (t.booking_date ?? t.value_date ?? t.transaction_date ?? '').slice(0, 10);
    return {
      // entry_reference är unik per bank och oföränderlig; transaction_id kan ändras och används inte som id
      externalId: t.entry_reference ? `eb:${t.entry_reference}` : undefined,
      bookingDate: date, amount, currency: t.transaction_amount.currency,
      description: (t.remittance_information ?? []).join(' ').slice(0, 500),
      reference: t.reference_number ?? '',
      counterparty: (credit ? t.debtor?.name : t.creditor?.name) ?? '',
      raw: t,
    };
  }).filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.bookingDate)));
}

// ---------- camt.054: bankens avisering om genomförda (eller avvisade) betalningar ----------

export interface Camt054Payment { endToEndId: string; amount: number; date: string; status: 'booked' | 'rejected'; reference: string; creditor: string }

/** Betalningar ur en camt.054 (BkToCstmrDbtCdtNtfctn). Belopp i öre (positivt), bokföringsdag från posten. */
export function parseCamt054(xml: string): Camt054Payment[] {
  if (!/BkToCstmrDbtCdtNtfctn/.test(xml)) throw new Error('Filen är inte en camt.054-avisering');
  const out: Camt054Payment[] = [];
  for (const e of all(xml, 'Ntry')) {
    const st = tag(e, 'Sts/Cd') ?? tag(e, 'Sts') ?? 'BOOK';
    const date = (tag(e, 'BookgDt/Dt') ?? tag(e, 'BookgDt/DtTm') ?? tag(e, 'ValDt/Dt') ?? '').slice(0, 10);
    const details = all(e, 'TxDtls');
    for (const d of details.length ? details : [e]) {
      const amt = tag(d, 'Amt') ?? tag(e, 'Amt');
      const e2e = tag(d, 'EndToEndId') ?? tag(d, 'InstrId') ?? '';
      if (!amt || !e2e || e2e === 'NOTPROVIDED') continue;
      const rejected = st === 'RJCT' || !!tag(d, 'RtrInf/Rsn/Cd');
      out.push({ endToEndId: e2e.trim(), amount: Math.abs(decimalToOre(amt)), date, status: rejected ? 'rejected' : 'booked',
        reference: tag(d, 'CdtrRefInf/Ref') ?? '', creditor: tag(d, 'Cdtr/Nm') ?? tag(d, 'Cdtr/Pty/Nm') ?? '' });
    }
  }
  return out.filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date));
}
