// Inkorg för leverantörsfakturor – ren logik utan databas (testbar)
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Filtyper som kan tolkas och visas */
export const INBOX_TYPES: Record<string, string> = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
};
export const INBOX_MAX_BYTES = 10 * 1024 * 1024;

export function mimeFor(filename: string, given: string): string {
  const g = given.toLowerCase().split(';')[0].trim();
  if (INBOX_TYPES[g]) return g;
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  return { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }[ext] ?? g;
}

/** Slumpad del av bolagets inkorgsadress, t.ex. "f-k3x9q2m7pa" */
export const newInboxToken = () => 'f-' + randomBytes(8).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10).padEnd(10, '7');

export const inboxAddress = (token: string, domain: string) => `${token}@${domain}`;

/** Hittar inkorgstoken i mottagaradresser ("Faktura <f-abc@in.example.se>", "f-abc+x@…") för rätt domän */
export function tokensIn(addresses: string[], domain: string): string[] {
  const out = new Set<string>();
  for (const raw of addresses) {
    const m = raw.toLowerCase().match(/([a-z0-9._+-]+)@([a-z0-9.-]+)/);
    if (!m || m[2] !== domain.toLowerCase()) continue;
    out.add(m[1].split('+')[0]);
  }
  return [...out];
}

/**
 * Kontrollerar en webhook-signatur enligt Svix (som Resend använder): HMAC-SHA256 av "id.timestamp.body" med
 * hemligheten (base64 efter prefixet "whsec_"). Huvudet kan innehålla flera "v1,<base64>" separerade med mellanslag.
 */
export function verifySvix(secret: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, body: string, now = Date.now()): boolean {
  if (!headers.id || !headers.timestamp || !headers.signature) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${headers.id}.${headers.timestamp}.${body}`).digest();
  return headers.signature.split(' ').some((part) => {
    const [v, sig] = part.split(',');
    if (v !== 'v1' || !sig) return false;
    const got = Buffer.from(sig, 'base64');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

export function signSvix(secret: string, id: string, timestamp: number, body: string): string {
  return 'v1,' + createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64')).update(`${id}.${timestamp}.${body}`).digest('base64');
}

/** Det som tolkningen ger, med belopp i öre */
export interface Extracted {
  documentType: 'invoice' | 'credit_note' | 'receipt' | 'reminder' | 'other';
  supplier: { name: string; orgnr: string; vatNumber: string; bankgiro: string; plusgiro: string; iban: string; email: string };
  invoiceNumber: string; invoiceDate: string; dueDate: string; paymentReference: string; currency: string;
  total: number | null; vat: number | null; account: number | null; description: string;
}

export interface RawExtraction {
  document_type: string;
  supplier_name: string | null; supplier_orgnr: string | null; supplier_vat_number: string | null;
  bankgiro: string | null; plusgiro: string | null; iban: string | null; supplier_email: string | null;
  invoice_number: string | null; invoice_date: string | null; due_date: string | null; ocr_or_payment_reference: string | null;
  currency: string | null; total_amount: number | null; vat_amount: number | null;
  suggested_account: number | null; description: string | null;
}

const isoDate = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : '');
const toOre = (n: number | null) => (n == null || !Number.isFinite(n) ? null : Math.round(Math.abs(n) * 100));
const clean = (s: string | null, max = 200) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Normaliserar tolkningen: datum, belopp i öre, rimliga konton och format på bankgiro/plusgiro/OCR */
export function normalizeExtraction(r: RawExtraction, validAccounts?: Set<number>): Extracted {
  const types = ['invoice', 'credit_note', 'receipt', 'reminder', 'other'] as const;
  const bg = clean(r.bankgiro).replace(/[^\d-]/g, '');
  const pg = clean(r.plusgiro).replace(/[^\d-]/g, '');
  const acc = r.suggested_account != null && Number.isInteger(r.suggested_account) && r.suggested_account >= 4000 && r.suggested_account <= 7999
    && (!validAccounts || validAccounts.has(r.suggested_account)) ? r.suggested_account : null;
  const total = toOre(r.total_amount);
  let vat = toOre(r.vat_amount);
  if (vat != null && total != null && vat >= total) vat = null;
  return {
    documentType: (types as readonly string[]).includes(r.document_type) ? r.document_type as Extracted['documentType'] : 'other',
    supplier: {
      name: clean(r.supplier_name, 120), orgnr: clean(r.supplier_orgnr, 20).replace(/[^\d-]/g, ''), vatNumber: clean(r.supplier_vat_number, 20).replace(/\s/g, '').toUpperCase(),
      bankgiro: /^\d{3,4}-?\d{4}$/.test(bg) ? bg : '', plusgiro: /^\d{1,7}-?\d$/.test(pg) ? pg : '', iban: clean(r.iban, 40).replace(/\s/g, '').toUpperCase(), email: clean(r.supplier_email, 120),
    },
    invoiceNumber: clean(r.invoice_number, 60), invoiceDate: isoDate(r.invoice_date), dueDate: isoDate(r.due_date),
    paymentReference: clean(r.ocr_or_payment_reference, 60), currency: (clean(r.currency, 3) || 'SEK').toUpperCase(),
    total, vat, account: acc, description: clean(r.description, 200),
  };
}
