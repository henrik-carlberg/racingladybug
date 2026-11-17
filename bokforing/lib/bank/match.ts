// Förslag på matchning av en banktransaktion mot öppna poster i bokföringen.

export interface TxForMatch { amount: number; bookingDate: string; description: string; reference: string; counterparty: string }
export interface OpenInvoice { id: number; number: number; ocr: string | null; total: number; customer: string }
export interface OpenSupplierInvoice { id: number; invoiceNumber: string; paymentReference: string; total: number; supplier: string; status: string }
export interface OpenVoucherLine { voucherId: number; label: string; date: string; amount: number; description: string }

export interface Suggestion {
  type: 'invoice' | 'supplier_invoice' | 'voucher';
  id: number;
  label: string;
  score: number; // 0–100
  reason: string;
}

const digits = (s: string) => s.replace(/\D/g, '');
const words = (s: string) => s.toLowerCase().split(/[^a-zåäö0-9]+/).filter((w) => w.length >= 3);
const daysBetween = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400_000;

export function suggestMatches(
  tx: TxForMatch,
  c: { invoices: OpenInvoice[]; supplierInvoices: OpenSupplierInvoice[]; voucherLines: OpenVoucherLine[] },
): Suggestion[] {
  const out: Suggestion[] = [];
  const text = `${tx.reference} ${tx.description} ${tx.counterparty}`;
  const textDigits: string[] = text.match(/\d+/g) ?? [];
  const textWords = new Set(words(text));
  const nameHit = (name: string) => words(name).some((w) => textWords.has(w));

  if (tx.amount > 0) {
    for (const i of c.invoices) {
      if (i.total !== tx.amount) continue;
      if (i.ocr && textDigits.includes(i.ocr)) out.push({ type: 'invoice', id: i.id, label: `Faktura ${i.number}, ${i.customer}`, score: 100, reason: 'OCR och belopp stämmer' });
      else if (textDigits.includes(String(i.number))) out.push({ type: 'invoice', id: i.id, label: `Faktura ${i.number}, ${i.customer}`, score: 90, reason: 'Fakturanummer och belopp stämmer' });
      else if (nameHit(i.customer)) out.push({ type: 'invoice', id: i.id, label: `Faktura ${i.number}, ${i.customer}`, score: 80, reason: 'Kundnamn och belopp stämmer' });
      else out.push({ type: 'invoice', id: i.id, label: `Faktura ${i.number}, ${i.customer}`, score: 55, reason: 'Belopp stämmer' });
    }
  } else if (tx.amount < 0) {
    for (const s of c.supplierInvoices) {
      if (s.total !== -tx.amount) continue;
      const label = `${s.supplier}, faktura ${s.invoiceNumber}`;
      const ref = digits(s.paymentReference);
      if (ref.length >= 4 && textDigits.includes(ref)) out.push({ type: 'supplier_invoice', id: s.id, label, score: 100, reason: 'OCR och belopp stämmer' });
      else if (nameHit(s.supplier)) out.push({ type: 'supplier_invoice', id: s.id, label, score: 85, reason: 'Leverantör och belopp stämmer' });
      else out.push({ type: 'supplier_invoice', id: s.id, label, score: 55, reason: 'Belopp stämmer' });
    }
  }
  for (const v of c.voucherLines) {
    if (v.amount !== tx.amount) continue;
    const d = daysBetween(v.date, tx.bookingDate);
    if (d > 10) continue;
    out.push({ type: 'voucher', id: v.voucherId, label: `${v.label} ${v.date} – ${v.description}`, score: Math.round(75 - d * 2), reason: 'Redan bokförd: samma belopp, närliggande datum' });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 4);
}
