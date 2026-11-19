// Kivra (digital brevlåda): mottagare, kanalval och innehåll. Ren logik, belopp i öre.
import { textPdf, type PdfLine } from './simple-pdf';

/** Personnummer eller organisationsnummer? Organisationsnummer har siffra 3 ≥ 2 (månad i personnummer är 01–12). */
export function recipientId(raw: string): { type: 'person'; ssn: string } | { type: 'company'; vat: string } | null {
  const d = raw.replace(/\D/g, '');
  const ten = d.length === 12 ? d.slice(2) : d;
  if (ten.length !== 10) return null;
  if (Number(ten[2]) >= 2) return { type: 'company', vat: `SE${ten}01` };
  const century = d.length === 12 ? d.slice(0, 2) : (Number(ten.slice(0, 2)) > new Date().getFullYear() % 100 ? '19' : '20');
  return { type: 'person', ssn: century + ten };
}

export type Channel = 'peppol' | 'kivra' | 'email' | 'paper';
export const CHANNEL_LABEL: Record<Channel, string> = { peppol: 'E-faktura (Peppol)', kivra: 'Kivra', email: 'E-post med länk', paper: 'Utskrift (post)' };

/** Bästa kanalen som mottagaren kan ta emot: e-faktura, Kivra, e-post, annars papper. Kundens val går före om det fungerar. */
export function chooseChannel(o: { preferred: 'auto' | Channel; peppol: boolean; kivra: boolean; email: boolean }): Channel {
  const can: Record<Channel, boolean> = { peppol: o.peppol, kivra: o.kivra, email: o.email, paper: true };
  if (o.preferred !== 'auto' && can[o.preferred]) return o.preferred;
  return (['peppol', 'kivra', 'email', 'paper'] as Channel[]).find((c) => can[c])!;
}

export function mapKivraStatus(s: unknown): 'sent' | 'delivered' | 'read' | 'failed' {
  const v = String(s ?? '').toLowerCase();
  return v === 'read' || v === 'opened' ? 'read' : v === 'delivered' || v === 'received' ? 'delivered' : v === 'failed' || v === 'rejected' || v === 'error' ? 'failed' : 'sent';
}

const kr = (o: number) => (o / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface InvoicePdf { company: string; orgnr: string; address: string; number: number; date: string; due: string; customer: string; customerAddress: string;
  lines: { description: string; quantity: number; unit: string; price: number; amount: number }[]; net: number; vat: number; total: number; bankgiro: string; ocr: string | null; link: string; credit: boolean }

export function invoicePdf(i: InvoicePdf): Buffer {
  const L: PdfLine[] = [
    { text: i.company, size: 16, bold: true, gap: 0 }, { text: `${i.orgnr}${i.address ? ' · ' + i.address : ''}`, size: 9 },
    { text: `${i.credit ? 'Kreditfaktura' : 'Faktura'} ${i.number}`, size: 18, bold: true, gap: 34 },
    { text: `Fakturadatum ${i.date}    Förfallodatum ${i.due}`, size: 10, gap: 18 },
    { text: i.customer, size: 11, bold: true, gap: 26 }, { text: i.customerAddress, size: 10 },
    { text: 'Beskrivning', bold: true, gap: 30 },
    ...i.lines.flatMap((l): PdfLine[] => [{ text: `${l.description.slice(0, 70)} – ${String(l.quantity).replace('.', ',')} ${l.unit} à ${kr(l.price)}`, gap: 15 }, { text: kr(l.amount), right: 545, gap: 0 }]),
    { text: 'Netto', gap: 26 }, { text: kr(i.net), right: 545, gap: 0 },
    { text: 'Moms', gap: 15 }, { text: kr(i.vat), right: 545, gap: 0 },
    { text: 'Att betala (kr)', bold: true, size: 12, gap: 18 }, { text: kr(i.total), bold: true, size: 12, right: 545, gap: 0 },
    { text: `Betala till bankgiro ${i.bankgiro || '–'}${i.ocr ? ` med OCR ${i.ocr}` : ''} senast ${i.due}.`, gap: 30 },
    { text: `Fakturan och betalning med kort eller Swish: ${i.link}`, size: 9, gap: 16 },
  ];
  return textPdf(L, `Faktura ${i.number}`);
}

export interface PayslipPdf { company: string; employee: string; period: string; paymentDate: string; items: { description: string; amount: number }[]; gross: number; tax: number; net: number }
export function payslipPdf(p: PayslipPdf): Buffer {
  return textPdf([
    { text: p.company, size: 16, bold: true, gap: 0 }, { text: `Lönebesked ${p.period}`, size: 18, bold: true, gap: 34 },
    { text: `${p.employee} · utbetalning ${p.paymentDate}`, gap: 18 },
    ...p.items.flatMap((x): PdfLine[] => [{ text: x.description.slice(0, 80), gap: 16 }, { text: kr(x.amount), right: 545, gap: 0 }]),
    { text: 'Bruttolön', bold: true, gap: 26 }, { text: kr(p.gross), right: 545, gap: 0 },
    { text: 'Preliminärskatt', gap: 15 }, { text: `-${kr(p.tax)}`, right: 545, gap: 0 },
    { text: 'Att få utbetalt (kr)', bold: true, size: 12, gap: 18 }, { text: kr(p.net), bold: true, size: 12, right: 545, gap: 0 },
  ], `Lönebesked ${p.period}`);
}
