import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { computeInvoice, lineNet } from '@/lib/invoice';
import { loadLines } from '@/lib/server/invoices';
import { peppolErrors, peppolXml, type PeppolInvoice } from '@/lib/peppol';

/** Samlar fakturans uppgifter i Peppol-format */
export async function peppolData(companyId: number, invoiceId: number): Promise<PeppolInvoice> {
  const [i] = await sql<{ number: number | null; status: string; issue: string; due: string; delivery: string; ocr: string | null; your_reference: string; our_reference: string; notes: string;
    reverse_charge: boolean; credit_of_id: number | null; c_name: string; c_orgnr: string; c_vat: string; c_address: string; c_postal: string; c_city: string; c_country: string; c_peppol: string; c_email: string; reduction_type: string | null }[]>`
    SELECT i.invoice_number AS number, i.status, to_char(i.invoice_date,'YYYY-MM-DD') AS issue, to_char(i.due_date,'YYYY-MM-DD') AS due, i.delivery_date AS delivery, i.ocr,
      i.your_reference, i.our_reference, i.notes, i.reverse_charge, i.credit_of_id, i.reduction_type,
      c.name AS c_name, c.orgnr AS c_orgnr, c.vat_number AS c_vat, c.address AS c_address, c.postal_code AS c_postal, c.city AS c_city, c.country AS c_country, c.peppol_id AS c_peppol, c.email AS c_email
    FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ${invoiceId} AND i.company_id = ${companyId}`;
  if (!i) throw new NotFoundError('Fakturan');
  if (i.status === 'draft' || !i.number) throw new ValidationError('Bokför fakturan innan den skickas som e-faktura');
  if (i.reduction_type) throw new ValidationError('Fakturor med ROT/RUT-avdrag går till privatpersoner och skickas inte som e-faktura');
  const [co] = await sql<{ name: string; orgnr: string; vat_number: string; address: string; postal_code: string; city: string; email: string; phone: string; f_skatt: boolean;
    bankgiro: string; plusgiro: string; iban: string; invoice_terms: number; late_interest: string }[]>`
    SELECT name, orgnr, vat_number, address, postal_code, city, email, phone, f_skatt, bankgiro, plusgiro, iban, invoice_terms, late_interest FROM companies WHERE id = ${companyId}`;
  const lines = await loadLines(sql, invoiceId);
  const t = computeInvoice(lines, { reverseCharge: i.reverse_charge });
  const [orig] = i.credit_of_id ? await sql<{ number: number; date: string }[]>`SELECT invoice_number AS number, to_char(invoice_date,'YYYY-MM-DD') AS date FROM invoices WHERE id = ${i.credit_of_id}` : [];
  return {
    number: i.number, issueDate: i.issue, dueDate: i.due, deliveryDate: i.delivery, buyerReference: i.your_reference || '', note: i.notes || undefined,
    credit: orig ? { originalNumber: orig.number, originalDate: orig.date } : undefined, reverseCharge: i.reverse_charge,
    lines: lines.map((l) => ({ description: l.description, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice, vatRate: l.vatRate, net: lineNet(l) })),
    totals: { net: t.net, vat: t.vat, rounding: t.rounding, total: t.total, vatByRate: Object.fromEntries(Object.entries(t.vatByRate).map(([r, v]) => [r, { base: v.base, vat: v.vat }])) },
    seller: { name: co.name, orgnr: co.orgnr, vatNumber: co.vat_number, address: co.address, postalCode: co.postal_code, city: co.city, country: 'SE', email: co.email, phone: co.phone, fSkatt: co.f_skatt },
    buyer: { name: i.c_name, orgnr: i.c_orgnr, vatNumber: i.c_vat, address: i.c_address, postalCode: i.c_postal, city: i.c_city, country: i.c_country || 'SE', endpoint: i.c_peppol || undefined, email: i.c_email },
    payment: { ocr: i.ocr, bankgiro: co.bankgiro, plusgiro: co.plusgiro, iban: co.iban, terms: `${co.invoice_terms} dagar netto. ${co.late_interest}` },
  };
}

export async function peppolCheck(companyId: number, invoiceId: number) {
  const d = await peppolData(companyId, invoiceId);
  return { errors: peppolErrors(d), data: d };
}

export async function peppolFile(companyId: number, invoiceId: number) {
  const { errors, data } = await peppolCheck(companyId, invoiceId);
  if (errors.length) throw new ValidationError(errors.join('. '));
  return { filename: `${data.credit ? 'kreditnota' : 'faktura'}-${data.number}.xml`, xml: peppolXml(data) };
}
