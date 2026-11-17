import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { createVoucher } from '@/lib/server/ledger';
import { auditBy } from '@/lib/server/audit';
import { emit } from '@/lib/server/events';
import { loadLines } from '@/lib/server/invoices';
import { computeInvoice, defaultSalesAccount, invoiceBookingLines, invoicePaymentLines, lineNet, type InvoiceLineInput } from '@/lib/invoice';
import { makeOcr } from '@/lib/validate';
import { replaceAccount } from '@/lib/ledger-lines';
import { ACC } from '@/lib/bas';
import { addDays } from '@/lib/format';
import type { Actor } from './actor';
import { arr, date, int, list, optInt, str, type Page } from './input';

export interface InvoiceOut {
  id: number; object: 'invoice'; number: number | null; status: 'draft' | 'booked' | 'paid' | 'credited';
  customer_id: number; customer_name: string; invoice_date: string; due_date: string; delivery_date: string;
  ocr: string | null; our_reference: string; your_reference: string; notes: string; reverse_charge: boolean; currency: 'SEK';
  total_net: number; total_vat: number; rounding: number; total: number; paid_date: string | null;
  credit_of_id: number | null; voucher_id: number | null; payment_voucher_id: number | null; created_at: string;
  lines: { description: string; quantity: number; unit: string; unit_price: number; vat_rate: number; account: number; amount: number }[];
}

async function fetchInvoice(db: Tx | typeof sql, companyId: number, id: number): Promise<InvoiceOut> {
  const [i] = await db<Omit<InvoiceOut, 'lines' | 'object' | 'currency'>[]>`
    SELECT i.id, i.invoice_number AS number, i.status, i.customer_id, c.name AS customer_name,
      to_char(i.invoice_date,'YYYY-MM-DD') AS invoice_date, to_char(i.due_date,'YYYY-MM-DD') AS due_date, i.delivery_date,
      i.ocr, i.our_reference, i.your_reference, i.notes, i.reverse_charge, i.total_net, i.total_vat, i.rounding, i.total,
      to_char(i.paid_date,'YYYY-MM-DD') AS paid_date, i.credit_of_id, i.voucher_id, i.payment_voucher_id, i.created_at
    FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ${id} AND i.company_id = ${companyId}`;
  if (!i) throw new NotFoundError('Fakturan');
  const lines = await loadLines(db, id);
  return {
    ...i, object: 'invoice', currency: 'SEK',
    lines: lines.map((l) => ({ description: l.description, quantity: l.quantity, unit: l.unit, unit_price: l.unitPrice, vat_rate: l.vatRate, account: l.account, amount: lineNet(l) })),
  };
}

export const getInvoice = (companyId: number, id: number) => fetchInvoice(sql, companyId, id);

export async function listInvoices(companyId: number, p: Page, f: { status?: string; customer_id?: number; from?: string; to?: string }) {
  const rows = await sql<{ id: number }[]>`SELECT id FROM invoices WHERE company_id = ${companyId}
    ${f.status ? sql`AND status = ${f.status}` : sql``} ${f.customer_id ? sql`AND customer_id = ${f.customer_id}` : sql``}
    ${f.from ? sql`AND invoice_date >= ${f.from}` : sql``} ${f.to ? sql`AND invoice_date <= ${f.to}` : sql``}
    ${p.startingAfter ? sql`AND id > ${p.startingAfter}` : sql``} ORDER BY id LIMIT ${p.limit + 1}`;
  const res = list([...rows], p);
  return { ...res, data: await Promise.all(res.data.map((r) => getInvoice(companyId, r.id))) };
}

function parseLines(input: Record<string, unknown>, reverseCharge: boolean): InvoiceLineInput[] {
  const lines = arr(input, 'lines', 'Fakturarader').map((r, i) => {
    const label = `Rad ${i + 1}`;
    const quantity = r.quantity == null || r.quantity === '' ? 1 : Number(r.quantity);
    const vatRate = (r.vat_rate == null || r.vat_rate === '' ? 25 : Number(r.vat_rate)) as InvoiceLineInput['vatRate'];
    if (!Number.isFinite(quantity) || quantity === 0) throw new ValidationError(`${label}: ogiltigt antal`);
    if (Math.round(quantity * 1000) !== quantity * 1000) throw new ValidationError(`${label}: antal får ha högst tre decimaler`);
    if (![0, 6, 12, 25].includes(vatRate)) throw new ValidationError(`${label}: momssats måste vara 0, 6, 12 eller 25`);
    return {
      description: str(r, 'description', { required: true, label: `${label}: beskrivning` }),
      quantity, unit: str(r, 'unit') || 'st', unitPrice: int(r, 'unit_price', `${label}: à-pris (öre)`), vatRate,
      account: optInt(r, 'account', `${label}: konto`) ?? defaultSalesAccount(vatRate, reverseCharge),
    };
  });
  if (lines.length === 0) throw new ValidationError('Fakturan måste ha minst en rad');
  return lines;
}

/** Skapar eller uppdaterar ett fakturautkast */
export async function saveDraft(actor: Actor, invoiceId: number | null, input: Record<string, unknown>): Promise<InvoiceOut> {
  return sql.begin((tx) => saveDraftTx(tx, actor, invoiceId, input));
}

/** Som saveDraft men i en befintlig transaktion (används av tidrapporteringen) */
export async function saveDraftTx(tx: Tx, actor: Actor, invoiceId: number | null, input: Record<string, unknown>): Promise<InvoiceOut> {
  const [company] = await tx<{ invoice_terms: number }[]>`SELECT invoice_terms FROM companies WHERE id = ${actor.companyId}`;
  const customerId = int(input, 'customer_id', 'Kund');
  const [cust] = await tx<{ reverse_charge: boolean; payment_terms: number | null }[]>`
    SELECT reverse_charge, payment_terms FROM customers WHERE id = ${customerId} AND company_id = ${actor.companyId}`;
  if (!cust) throw new ValidationError('Kunden finns inte');
  const lines = parseLines(input, cust.reverse_charge);
  const invoiceDate = date(input, 'invoice_date', 'Fakturadatum');
  const dueDate = date(input, 'due_date', 'Förfallodatum', false) || addDays(invoiceDate, cust.payment_terms ?? company.invoice_terms);
  const t = computeInvoice(lines, { reverseCharge: cust.reverse_charge });
  const head = {
    customer_id: customerId, invoice_date: invoiceDate, due_date: dueDate, delivery_date: str(input, 'delivery_date'),
    our_reference: str(input, 'our_reference'), your_reference: str(input, 'your_reference'), notes: str(input, 'notes'),
    reverse_charge: cust.reverse_charge, total_net: t.net, total_vat: t.vat, rounding: t.rounding, total: t.total,
  };
  {
    let id = invoiceId ?? 0;
    if (invoiceId) {
      const r = await tx`UPDATE invoices SET ${tx(head)} WHERE id = ${invoiceId} AND company_id = ${actor.companyId} AND status = 'draft' RETURNING id`;
      if (!r.length) throw new ConflictError('Endast utkast kan ändras');
      await tx`DELETE FROM invoice_lines WHERE invoice_id = ${invoiceId}`;
    } else {
      [{ id }] = await tx<{ id: number }[]>`INSERT INTO invoices ${tx({ ...head, company_id: actor.companyId })} RETURNING id`;
    }
    await tx`INSERT INTO invoice_lines ${tx(lines.map((l, i) => ({
      invoice_id: id, position: i + 1, description: l.description, quantity: l.quantity, unit: l.unit,
      unit_price: l.unitPrice, vat_rate: l.vatRate, account_number: l.account,
    })))}`;
    await auditBy(tx, actor, invoiceId ? 'update_draft' : 'create_draft', 'invoice', id);
    const out = await fetchInvoice(tx, actor.companyId, id);
    await emit(tx, actor.companyId, invoiceId ? 'invoice.updated' : 'invoice.created', out);
    return out;
  }
}

async function nextInvoiceNumber(tx: Tx, companyId: number): Promise<number> {
  const [{ n }] = await tx<{ n: number }[]>`UPDATE companies SET next_invoice_no = next_invoice_no + 1 WHERE id = ${companyId} RETURNING next_invoice_no - 1 AS n`;
  return n;
}

export async function accountingMethod(tx: Tx | typeof sql, companyId: number): Promise<'invoice' | 'cash'> {
  const [c] = await tx<{ m: 'invoice' | 'cash' }[]>`SELECT accounting_method AS m FROM companies WHERE id = ${companyId}`;
  return c.m;
}

/** Bokför fakturan: fakturanummer + OCR och verifikation (kundfordran mot intäkt och moms).
 *  Kontantmetoden: fakturan får nummer och OCR men bokförs först när den betalas (eller per bokslutsdagen). */
export async function bookInvoice(actor: Actor, invoiceId: number): Promise<InvoiceOut> {
  return sql.begin(async (tx) => {
    const [inv] = await tx<{ status: string; invoice_date: string; reverse_charge: boolean; customer: string }[]>`
      SELECT i.status, to_char(i.invoice_date,'YYYY-MM-DD') AS invoice_date, i.reverse_charge, c.name AS customer
      FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ${invoiceId} AND i.company_id = ${actor.companyId} FOR UPDATE OF i`;
    if (!inv) throw new NotFoundError('Fakturan');
    if (inv.status !== 'draft') throw new ConflictError('Fakturan är redan bokförd');
    const no = await nextInvoiceNumber(tx, actor.companyId);
    const lines = await loadLines(tx, invoiceId);
    const t = computeInvoice(lines, { reverseCharge: inv.reverse_charge });
    // En faktura på 0 kr (t.ex. timbanksavräkning utan övertid) bokförs inte och är direkt reglerad
    const zero = t.total === 0 && t.net === 0;
    const v = zero || (await accountingMethod(tx, actor.companyId)) === 'cash' ? null : await createVoucher(tx, {
      actor, date: inv.invoice_date, description: `Kundfaktura ${no}, ${inv.customer}`,
      lines: invoiceBookingLines(lines, t), sourceType: 'invoice', sourceId: invoiceId, series: 'B',
    });
    await tx`UPDATE invoices SET status = ${zero ? 'paid' : 'booked'}, paid_date = ${zero ? inv.invoice_date : null}, invoice_number = ${no}, ocr = ${makeOcr(no)}, voucher_id = ${v?.id ?? null},
      total_net = ${t.net}, total_vat = ${t.vat}, rounding = ${t.rounding}, total = ${t.total} WHERE id = ${invoiceId}`;
    await auditBy(tx, actor, 'book', 'invoice', invoiceId, { number: no });
    const out = await fetchInvoice(tx, actor.companyId, invoiceId);
    await emit(tx, actor.companyId, 'invoice.booked', out);
    return out;
  });
}

export async function deleteDraft(actor: Actor, invoiceId: number) {
  await sql.begin(async (tx) => {
    const out = await fetchInvoice(tx, actor.companyId, invoiceId);
    if (out.status !== 'draft') throw new ConflictError('Endast utkast kan tas bort');
    await tx`DELETE FROM invoices WHERE id = ${invoiceId}`;
    await auditBy(tx, actor, 'delete_draft', 'invoice', invoiceId);
    await emit(tx, actor.companyId, 'invoice.deleted', { id: invoiceId, object: 'invoice', deleted: true });
  });
  return { id: invoiceId, object: 'invoice', deleted: true };
}

/** Registrera inbetalning (hela beloppet): bank mot kundfordran */
export async function registerPayment(actor: Actor, invoiceId: number, input: Record<string, unknown>): Promise<InvoiceOut> {
  return sql.begin((tx) => registerPaymentTx(tx, actor, invoiceId, input));
}

/** Som registerPayment men i en befintlig transaktion (används av bankavstämningen) */
export async function registerPaymentTx(tx: Tx, actor: Actor, invoiceId: number, input: Record<string, unknown>): Promise<InvoiceOut> {
  const [inv] = await tx<{ status: string; total: number; invoice_number: number; voucher_id: number | null; reverse_charge: boolean; customer: string }[]>`
    SELECT i.status, i.total, i.invoice_number, i.voucher_id, i.reverse_charge, c.name AS customer
    FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ${invoiceId} AND i.company_id = ${actor.companyId} FOR UPDATE OF i`;
  if (!inv) throw new NotFoundError('Fakturan');
  if (inv.status !== 'booked') throw new ConflictError('Endast bokförda, obetalda fakturor kan registreras som betalda');
  const amount = optInt(input, 'amount', 'Belopp') ?? inv.total;
  if (amount !== inv.total) throw new ValidationError('Delbetalningar stöds inte ännu – beloppet måste vara fakturans totalbelopp');
  const d = date(input, 'date', 'Betaldatum');
  const bank = optInt(input, 'bank_account', 'Bankkonto') ?? 1930;
  if (bank < 1900 || bank > 1999) throw new ValidationError('Bankkonto måste vara ett 19xx-konto');
  // Kontantmetoden: fakturan är inte bokförd än – intäkt och moms bokförs direkt mot banken
  const lines = inv.voucher_id ? invoicePaymentLines(amount, bank) : await (async () => {
    const il = await loadLines(tx, invoiceId);
    return replaceAccount(invoiceBookingLines(il, computeInvoice(il, { reverseCharge: inv.reverse_charge })), ACC.customerReceivables, bank);
  })();
  const v = await createVoucher(tx, {
    actor, date: d, description: inv.voucher_id ? `Inbetalning kundfaktura ${inv.invoice_number}` : `Inbetalning kundfaktura ${inv.invoice_number}, ${inv.customer} (kontantmetoden)`,
    lines, sourceType: 'invoice_payment', sourceId: invoiceId, series: 'B',
  });
  await tx`UPDATE invoices SET status = 'paid', paid_date = ${d}, payment_voucher_id = ${v.id} WHERE id = ${invoiceId}`;
  await auditBy(tx, actor, 'paid', 'invoice', invoiceId);
  const out = await fetchInvoice(tx, actor.companyId, invoiceId);
  await emit(tx, actor.companyId, 'invoice.paid', out);
  return out;
}

/** Kreditera en bokförd, obetald faktura. Returnerar kreditfakturan. */
export async function creditInvoice(actor: Actor, invoiceId: number, input: Record<string, unknown>): Promise<InvoiceOut> {
  return sql.begin(async (tx) => {
    const [inv] = await tx<{ status: string; customer_id: number; invoice_number: number; reverse_charge: boolean; customer: string; voucher_id: number | null; total: number }[]>`
      SELECT i.status, i.customer_id, i.invoice_number, i.reverse_charge, c.name AS customer, i.voucher_id, i.total
      FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ${invoiceId} AND i.company_id = ${actor.companyId} FOR UPDATE OF i`;
    if (!inv) throw new NotFoundError('Fakturan');
    if (inv.status !== 'booked' && !(inv.status === 'paid' && inv.total === 0)) throw new ConflictError('Endast bokförda, obetalda fakturor kan krediteras');
    const lines = (await loadLines(tx, invoiceId)).map((l) => ({ ...l, quantity: -l.quantity }));
    const t = computeInvoice(lines, { reverseCharge: inv.reverse_charge });
    const d = date(input, 'date', 'Datum');
    const no = await nextInvoiceNumber(tx, actor.companyId);
    const [{ id: creditId }] = await tx<{ id: number }[]>`INSERT INTO invoices ${tx({
      company_id: actor.companyId, customer_id: inv.customer_id, invoice_number: no, invoice_date: d, due_date: d,
      status: 'paid', notes: `Kreditering av faktura ${inv.invoice_number}`, reverse_charge: inv.reverse_charge,
      total_net: t.net, total_vat: t.vat, rounding: t.rounding, total: t.total, credit_of_id: invoiceId, paid_date: d,
    })} RETURNING id`;
    await tx`INSERT INTO invoice_lines ${tx(lines.map((l, i) => ({
      invoice_id: creditId, position: i + 1, description: l.description, quantity: l.quantity, unit: l.unit,
      unit_price: l.unitPrice, vat_rate: l.vatRate, account_number: l.account,
    })))}`;
    // Negativa antal ger negativa belopp → konteringen vänder automatiskt sidorna.
    // Kontantmetoden: originalet är aldrig bokfört, så krediteringen bokförs inte heller.
    if (inv.voucher_id) {
      const v = await createVoucher(tx, {
        actor, date: d, description: `Kreditfaktura ${no} (kreditering av ${inv.invoice_number}), ${inv.customer}`,
        lines: invoiceBookingLines(lines, t), sourceType: 'invoice', sourceId: creditId, series: 'B',
      });
      await tx`UPDATE invoices SET voucher_id = ${v.id} WHERE id = ${creditId}`;
    }
    await tx`UPDATE invoices SET status = 'credited' WHERE id = ${invoiceId}`;
    // Tidrader på fakturan blir åter ofakturerade (kan tas med i ett nytt underlag eller en ny avräkning)
    await tx`UPDATE time_entries SET invoice_id = NULL WHERE invoice_id = ${invoiceId}`;
    await auditBy(tx, actor, 'credit', 'invoice', invoiceId, { credit_invoice: no });
    const out = await fetchInvoice(tx, actor.companyId, creditId);
    await emit(tx, actor.companyId, 'invoice.credited', out);
    return out;
  });
}

/** Kontantmetoden: bokför obetalda kundfakturor per bokslutsdagen (kundfordran mot intäkt och moms).
 *  När de sedan betalas bokförs betalningen mot kundfordran som vid faktureringsmetoden. */
export async function bookOpenInvoicesAtYearEnd(tx: Tx, actor: Actor, endDate: string): Promise<number> {
  const open = await tx<{ id: number; invoice_number: number; reverse_charge: boolean; customer: string }[]>`
    SELECT i.id, i.invoice_number, i.reverse_charge, c.name AS customer FROM invoices i JOIN customers c ON c.id = i.customer_id
    WHERE i.company_id = ${actor.companyId} AND i.status = 'booked' AND i.voucher_id IS NULL AND i.invoice_date <= ${endDate}
    ORDER BY i.invoice_number FOR UPDATE OF i`;
  for (const inv of open) {
    const lines = await loadLines(tx, inv.id);
    const v = await createVoucher(tx, {
      actor, date: endDate, description: `Obetald kundfaktura ${inv.invoice_number}, ${inv.customer} – per bokslutsdagen`,
      lines: invoiceBookingLines(lines, computeInvoice(lines, { reverseCharge: inv.reverse_charge })), sourceType: 'invoice', sourceId: inv.id, series: 'B',
    });
    await tx`UPDATE invoices SET voucher_id = ${v.id} WHERE id = ${inv.id}`;
    await auditBy(tx, actor, 'book_yearend', 'invoice', inv.id);
  }
  return open.length;
}
