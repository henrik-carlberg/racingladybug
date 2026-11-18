// Mottagna e-fakturor (Peppol BIS Billing 3 / UBL 2.1) → samma format som Claudes avläsning – ren logik (testbar)
import { normalizeExtraction, type Extracted } from './inbox';

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const block = (xml: string, t: string) => xml.match(new RegExp(`<(?:\\w+:)?${t}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${t}>`))?.[1] ?? null;
const all = (xml: string, t: string) => [...xml.matchAll(new RegExp(`<(?:\\w+:)?${t}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${t}>`, 'g'))].map((m) => m[1]);
const val = (xml: string | null, path: string): string | null => {
  let cur: string | null = xml;
  for (const t of path.split('/')) { if (cur == null) return null; cur = block(cur, t); }
  return cur == null ? null : decode(cur.trim());
};
/** Tar bort nästlade block så att t.ex. fakturans cbc:ID inte förväxlas med en rads ID */
const stripBlocks = (xml: string, tags: string[]) => tags.reduce((s, t) => s.replace(new RegExp(`<(?:\\w+:)?${t}(?:\\s[^>]*)?>[\\s\\S]*?</(?:\\w+:)?${t}>`, 'g'), ''), xml);

export const isUbl = (xml: string) => /<(?:\w+:)?(Invoice|CreditNote)[\s>]/.test(xml) && /urn:oasis:names:specification:ubl:schema:xsd:(Invoice|CreditNote)-2/.test(xml);

export function parseUbl(xml: string): Extracted {
  if (!isUbl(xml)) throw new Error('Filen är inte en e-faktura (UBL/Peppol BIS)');
  const credit = /<(?:\w+:)?CreditNote[\s>]/.test(xml);
  const head = stripBlocks(xml, ['AccountingSupplierParty', 'AccountingCustomerParty', 'InvoiceLine', 'CreditNoteLine', 'PaymentMeans', 'TaxTotal', 'LegalMonetaryTotal', 'AdditionalDocumentReference', 'OrderReference', 'BillingReference', 'Delivery', 'PaymentTerms', 'AllowanceCharge', 'InvoicePeriod']);
  const seller = val(xml, 'AccountingSupplierParty/Party');
  const pm = block(xml, 'PaymentMeans');
  const accounts = pm ? all(pm, 'PayeeFinancialAccount') : [];
  const acc = (branch: string) => accounts.find((a) => val(a, 'FinancialInstitutionBranch/ID') === branch);
  const bg = acc('9900'), pg = acc('9960');
  const iban = accounts.find((a) => /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test((val(a, 'ID') ?? '').replace(/\s/g, '')));
  const orgnr = val(seller, 'PartyLegalEntity/CompanyID') ?? '';
  const total = val(xml, 'LegalMonetaryTotal/PayableAmount');
  const firstLine = block(xml, credit ? 'CreditNoteLine' : 'InvoiceLine');
  const digits = (s: string | null) => (s ?? '').replace(/\D/g, '');
  const fmtBg = (s: string) => (s.length >= 7 ? `${s.slice(0, -4)}-${s.slice(-4)}` : s);
  const fmtPg = (s: string) => (s.length >= 2 ? `${s.slice(0, -1)}-${s.slice(-1)}` : s);
  return normalizeExtraction({
    document_type: credit ? 'credit_note' : 'invoice',
    supplier_name: val(seller, 'PartyLegalEntity/RegistrationName') ?? val(seller, 'PartyName/Name'),
    supplier_orgnr: /^\d{10}$/.test(digits(orgnr)) ? `${digits(orgnr).slice(0, 6)}-${digits(orgnr).slice(6)}` : orgnr,
    supplier_vat_number: val(seller, 'PartyTaxScheme/CompanyID'),
    bankgiro: bg ? fmtBg(digits(val(bg, 'ID'))) : null, plusgiro: pg ? fmtPg(digits(val(pg, 'ID'))) : null,
    iban: iban ? (val(iban, 'ID') ?? '').replace(/\s/g, '') : null,
    supplier_email: val(seller, 'Contact/ElectronicMail'),
    invoice_number: val(head, 'ID'), invoice_date: val(head, 'IssueDate'), due_date: val(head, 'DueDate') ?? val(xml, 'PaymentMeans/PaymentDueDate'),
    ocr_or_payment_reference: pm ? val(pm, 'PaymentID') : null,
    currency: val(head, 'DocumentCurrencyCode'),
    total_amount: total != null ? Number(total) : null,
    vat_amount: (() => { const t = block(xml, 'TaxTotal'); const v = t ? val(t, 'TaxAmount') : null; return v != null ? Number(v) : null; })(),
    suggested_account: null,
    description: firstLine ? val(firstLine, 'Item/Name') : null,
  });
}
