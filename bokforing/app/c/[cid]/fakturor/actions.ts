'use server';
import { unstable_rethrow } from 'next/navigation';
import { sql } from '@/lib/db';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { audit } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { computeInvoice, invoiceBookingLines, invoicePaymentLines, type InvoiceLineInput } from '@/lib/invoice';
import { parseAmount } from '@/lib/money';
import { makeOcr } from '@/lib/validate';
import { addDays } from '@/lib/format';
import { loadLines } from '@/lib/server/invoices';

export type FormState = { error?: string } | undefined;

function parseLines(json: string): InvoiceLineInput[] {
  const raw = JSON.parse(json || '[]') as Record<string, string>[];
  const lines = raw.filter((r) => r.description || r.price).map((r, i) => {
    const quantity = Number(String(r.quantity).replace(',', '.'));
    const unitPrice = parseAmount(r.price);
    const vatRate = Number(r.vat) as InvoiceLineInput['vatRate'];
    const account = Number(r.account);
    if (!r.description) throw new Error(`Rad ${i + 1}: beskrivning saknas`);
    if (!Number.isFinite(quantity) || quantity === 0) throw new Error(`Rad ${i + 1}: ogiltigt antal`);
    if (unitPrice == null) throw new Error(`Rad ${i + 1}: ogiltigt pris`);
    if (![0, 6, 12, 25].includes(vatRate)) throw new Error(`Rad ${i + 1}: ogiltig momssats`);
    if (!account) throw new Error(`Rad ${i + 1}: intäktskonto saknas`);
    return { description: r.description, quantity, unit: r.unit || 'st', unitPrice, vatRate, account };
  });
  if (lines.length === 0) throw new Error('Fakturan måste ha minst en rad');
  return lines;
}

/** Sparar ett fakturautkast (nytt eller befintligt) */
export async function saveDraft(cid: number, invoiceId: number | null, _prev: FormState, fd: FormData): Promise<FormState> {
  const { company, user } = await requireCompany(cid);
  let id = invoiceId ?? 0;
  try {
    const lines = parseLines(str(fd, 'lines'));
    const customerId = Number(str(fd, 'customer_id'));
    const [cust] = await sql<{ reverse_charge: boolean; payment_terms: number | null }[]>`
      SELECT reverse_charge, payment_terms FROM customers WHERE id = ${customerId} AND company_id = ${company.id}`;
    if (!cust) throw new Error('Välj kund');
    const invoiceDate = str(fd, 'invoice_date');
    const dueDate = str(fd, 'due_date') || addDays(invoiceDate, cust.payment_terms ?? company.invoice_terms);
    const t = computeInvoice(lines, { reverseCharge: cust.reverse_charge });
    const head = {
      customer_id: customerId, invoice_date: invoiceDate, due_date: dueDate, our_reference: str(fd, 'our_reference'),
      your_reference: str(fd, 'your_reference'), delivery_date: str(fd, 'delivery_date'), notes: str(fd, 'notes'), reverse_charge: cust.reverse_charge,
      total_net: t.net, total_vat: t.vat, rounding: t.rounding, total: t.total,
    };
    await sql.begin(async (tx) => {
      if (invoiceId) {
        const r = await tx`UPDATE invoices SET ${tx(head)} WHERE id = ${invoiceId} AND company_id = ${company.id} AND status = 'draft' RETURNING id`;
        if (!r.length) throw new Error('Endast utkast kan ändras');
        await tx`DELETE FROM invoice_lines WHERE invoice_id = ${invoiceId}`;
      } else {
        [{ id }] = await tx<{ id: number }[]>`INSERT INTO invoices ${tx({ ...head, company_id: company.id })} RETURNING id`;
      }
      await tx`INSERT INTO invoice_lines ${tx(lines.map((l, i) => ({
        invoice_id: id, position: i + 1, description: l.description, quantity: l.quantity, unit: l.unit,
        unit_price: l.unitPrice, vat_rate: l.vatRate, account_number: l.account,
      })))}`;
      await audit(tx, { companyId: company.id, userId: user.id, action: 'save_draft', entity: 'invoice', entityId: id });
    });
  } catch (e) {
    unstable_rethrow(e);
    return { error: e instanceof Error ? e.message : 'Något gick fel' };
  }
  done(`/c/${cid}/fakturor/${id}`, 'Utkastet är sparat');
}

/** Bokför fakturan: tilldelar fakturanummer + OCR och skapar verifikation (kundfordran mot intäkt och moms) */
export async function bookInvoice(cid: number, invoiceId: number) {
  const { company, user } = await requireCompany(cid);
  await attempt(`/c/${cid}/fakturor/${invoiceId}`, async () => {
    await sql.begin(async (tx) => {
      const [inv] = await tx<{ id: number; status: string; invoice_date: string; reverse_charge: boolean; customer: string; credit_of_id: number | null }[]>`
        SELECT i.id, i.status, to_char(i.invoice_date,'YYYY-MM-DD') AS invoice_date, i.reverse_charge, c.name AS customer, i.credit_of_id
        FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ${invoiceId} AND i.company_id = ${company.id} FOR UPDATE OF i`;
      if (!inv || inv.status !== 'draft') throw new Error('Fakturan är redan bokförd');
      const [{ next_invoice_no: no }] = await tx<{ next_invoice_no: number }[]>`
        UPDATE companies SET next_invoice_no = next_invoice_no + 1 WHERE id = ${company.id} RETURNING next_invoice_no - 1 AS next_invoice_no`;
      const lines = await loadLines(tx, invoiceId);
      const t = computeInvoice(lines, { reverseCharge: inv.reverse_charge });
      const v = await createVoucher(tx, {
        companyId: company.id, userId: user.id, date: inv.invoice_date, description: `Kundfaktura ${no}, ${inv.customer}`,
        lines: invoiceBookingLines(lines, t), sourceType: 'invoice', sourceId: invoiceId, series: 'B',
      });
      await tx`UPDATE invoices SET status = 'booked', invoice_number = ${no}, ocr = ${makeOcr(no)}, voucher_id = ${v.id},
        total_net = ${t.net}, total_vat = ${t.vat}, rounding = ${t.rounding}, total = ${t.total} WHERE id = ${invoiceId}`;
      await audit(tx, { companyId: company.id, userId: user.id, action: 'book', entity: 'invoice', entityId: invoiceId, details: { number: no } });
    });
  });
  done(`/c/${cid}/fakturor/${invoiceId}`, 'Fakturan är bokförd och klar att skicka');
}

export async function deleteDraft(cid: number, invoiceId: number) {
  const { company, user } = await requireCompany(cid);
  await sql`DELETE FROM invoices WHERE id = ${invoiceId} AND company_id = ${company.id} AND status = 'draft'`;
  await audit(sql, { companyId: company.id, userId: user.id, action: 'delete_draft', entity: 'invoice', entityId: invoiceId });
  done(`/c/${cid}/fakturor`, 'Utkastet är borttaget');
}

/** Registrera inbetalning: bank mot kundfordran */
export async function registerPayment(cid: number, invoiceId: number, fd: FormData) {
  const { company, user } = await requireCompany(cid);
  await attempt(`/c/${cid}/fakturor/${invoiceId}`, async () => {
    await sql.begin(async (tx) => {
      const [inv] = await tx<{ status: string; total: number; invoice_number: number }[]>`
        SELECT status, total, invoice_number FROM invoices WHERE id = ${invoiceId} AND company_id = ${company.id} FOR UPDATE`;
      if (!inv || inv.status !== 'booked') throw new Error('Endast bokförda, obetalda fakturor kan registreras som betalda');
      const amount = parseAmount(str(fd, 'amount'));
      if (amount !== inv.total) throw new Error('Delbetalningar stöds inte ännu – beloppet måste vara fakturans totalbelopp');
      const date = str(fd, 'date');
      const v = await createVoucher(tx, {
        companyId: company.id, userId: user.id, date, description: `Inbetalning kundfaktura ${inv.invoice_number}`,
        lines: invoicePaymentLines(amount, Number(str(fd, 'bank_account')) || 1930), sourceType: 'invoice_payment', sourceId: invoiceId, series: 'B',
      });
      await tx`UPDATE invoices SET status = 'paid', paid_date = ${date}, payment_voucher_id = ${v.id} WHERE id = ${invoiceId}`;
      await audit(tx, { companyId: company.id, userId: user.id, action: 'paid', entity: 'invoice', entityId: invoiceId });
    });
  });
  done(`/c/${cid}/fakturor/${invoiceId}`, 'Inbetalningen är bokförd');
}

/** Kreditera en bokförd, obetald faktura: skapar och bokför en kreditfaktura med negativa belopp */
export async function creditInvoice(cid: number, invoiceId: number, fd: FormData) {
  const { company, user } = await requireCompany(cid);
  let creditId = 0;
  await attempt(`/c/${cid}/fakturor/${invoiceId}`, async () => {
    await sql.begin(async (tx) => {
      const [inv] = await tx<{ status: string; customer_id: number; invoice_number: number; reverse_charge: boolean; customer: string }[]>`
        SELECT i.status, i.customer_id, i.invoice_number, i.reverse_charge, c.name AS customer
        FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ${invoiceId} AND i.company_id = ${company.id} FOR UPDATE OF i`;
      if (!inv || inv.status !== 'booked') throw new Error('Endast bokförda, obetalda fakturor kan krediteras');
      const lines = (await loadLines(tx, invoiceId)).map((l) => ({ ...l, quantity: -l.quantity }));
      const t = computeInvoice(lines, { reverseCharge: inv.reverse_charge });
      const date = str(fd, 'date');
      const [{ next_invoice_no: no }] = await tx<{ next_invoice_no: number }[]>`
        UPDATE companies SET next_invoice_no = next_invoice_no + 1 WHERE id = ${company.id} RETURNING next_invoice_no - 1 AS next_invoice_no`;
      [{ id: creditId }] = await tx<{ id: number }[]>`INSERT INTO invoices ${tx({
        company_id: company.id, customer_id: inv.customer_id, invoice_number: no, invoice_date: date, due_date: date,
        status: 'paid', notes: `Kreditering av faktura ${inv.invoice_number}`, reverse_charge: inv.reverse_charge,
        total_net: t.net, total_vat: t.vat, rounding: t.rounding, total: t.total, credit_of_id: invoiceId, paid_date: date,
      })} RETURNING id`;
      await tx`INSERT INTO invoice_lines ${tx(lines.map((l, i) => ({
        invoice_id: creditId, position: i + 1, description: l.description, quantity: l.quantity, unit: l.unit,
        unit_price: l.unitPrice, vat_rate: l.vatRate, account_number: l.account,
      })))}`;
      // computeInvoice med negativa antal ger negativa belopp → invoiceBookingLines vänder automatiskt sidorna
      const v = await createVoucher(tx, {
        companyId: company.id, userId: user.id, date, description: `Kreditfaktura ${no} (kreditering av ${inv.invoice_number}), ${inv.customer}`,
        lines: invoiceBookingLines(lines, t), sourceType: 'invoice', sourceId: creditId, series: 'B',
      });
      await tx`UPDATE invoices SET voucher_id = ${v.id} WHERE id = ${creditId}`;
      await tx`UPDATE invoices SET status = 'credited' WHERE id = ${invoiceId}`;
      await audit(tx, { companyId: company.id, userId: user.id, action: 'credit', entity: 'invoice', entityId: invoiceId, details: { credit_invoice: no } });
    });
  });
  done(`/c/${cid}/fakturor/${creditId}`, 'Kreditfakturan är bokförd');
}
