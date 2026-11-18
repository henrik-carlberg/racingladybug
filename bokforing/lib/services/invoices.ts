import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { createVoucher } from '@/lib/server/ledger';
import { auditBy } from '@/lib/server/audit';
import { emit } from '@/lib/server/events';
import { loadLines } from '@/lib/server/invoices';
import { computeInvoice, defaultSalesAccount, invoiceBookingLines, invoicePaymentLines, lineNet, type InvoiceLineInput } from '@/lib/invoice';
import { makeOcr, normalizePersonalNumber } from '@/lib/validate';
import { computeReduction, labourInclVat, reductionErrors, remainingForBuyer, REDUCTION, type ReductionType } from '@/lib/rotrut';
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
  reduction_type: ReductionType | null; tax_reduction: number; buyer_pnr: string; property: string; brf_orgnr: string; apartment_no: string; work_type: string;
  reduction_status: string | null;
  lines: { description: string; quantity: number; unit: string; unit_price: number; vat_rate: number; account: number; amount: number; labor: boolean }[];
}

async function fetchInvoice(db: Tx | typeof sql, companyId: number, id: number): Promise<InvoiceOut> {
  const [i] = await db<Omit<InvoiceOut, 'lines' | 'object' | 'currency'>[]>`
    SELECT i.id, i.invoice_number AS number, i.status, i.customer_id, c.name AS customer_name,
      to_char(i.invoice_date,'YYYY-MM-DD') AS invoice_date, to_char(i.due_date,'YYYY-MM-DD') AS due_date, i.delivery_date,
      i.ocr, i.our_reference, i.your_reference, i.notes, i.reverse_charge, i.total_net, i.total_vat, i.rounding, i.total,
      to_char(i.paid_date,'YYYY-MM-DD') AS paid_date, i.credit_of_id, i.voucher_id, i.payment_voucher_id, i.created_at,
      i.reduction_type, i.tax_reduction, i.buyer_pnr, i.property, i.brf_orgnr, i.apartment_no, i.work_type, i.reduction_status
    FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ${id} AND i.company_id = ${companyId}`;
  if (!i) throw new NotFoundError('Fakturan');
  const lines = await loadLines(db, id);
  return {
    ...i, object: 'invoice', currency: 'SEK',
    lines: lines.map((l) => ({ description: l.description, quantity: l.quantity, unit: l.unit, unit_price: l.unitPrice, vat_rate: l.vatRate, account: l.account, amount: lineNet(l), labor: !!l.labor })),
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
      labor: r.labor === true || r.labor === 'true' || r.labor === 'on',
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
  const rr = await readReduction(tx, actor.companyId, invoiceId, input, lines, t, cust.reverse_charge, invoiceDate);
  const head = {
    customer_id: customerId, invoice_date: invoiceDate, due_date: dueDate, delivery_date: str(input, 'delivery_date'),
    our_reference: str(input, 'our_reference'), your_reference: str(input, 'your_reference'), notes: str(input, 'notes'),
    reverse_charge: cust.reverse_charge, total_net: t.net, total_vat: t.vat, rounding: t.rounding, total: t.total - rr.tax_reduction, ...rr,
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
      unit_price: l.unitPrice, vat_rate: l.vatRate, account_number: l.account, labor: !!l.labor,
    })))}`;
    await auditBy(tx, actor, invoiceId ? 'update_draft' : 'create_draft', 'invoice', id);
    const out = await fetchInvoice(tx, actor.companyId, id);
    await emit(tx, actor.companyId, invoiceId ? 'invoice.updated' : 'invoice.created', out);
    return out;
  }
}

/** Hur mycket ROT/RUT som redan dragits för köparen under kalenderåret, på andra fakturor i bolaget (öre) */
async function usedByBuyer(db: Tx | typeof sql, companyId: number, pnr: string, year: string, exceptId: number | null) {
  const rows = await db<{ type: ReductionType; sum: number }[]>`
    SELECT reduction_type AS type, COALESCE(SUM(COALESCE(reduction_paid, tax_reduction)), 0)::bigint AS sum FROM invoices
    WHERE company_id = ${companyId} AND buyer_pnr = ${pnr} AND reduction_type IS NOT NULL AND status IN ('booked','paid')
      AND credit_of_id IS NULL AND to_char(invoice_date,'YYYY') = ${year} AND id <> ${exceptId ?? 0} GROUP BY reduction_type`;
  return { rot: Number(rows.find((r) => r.type === 'rot')?.sum ?? 0), rut: Number(rows.find((r) => r.type === 'rut')?.sum ?? 0) };
}

/** ROT/RUT-uppgifterna på ett utkast och beräknad skattereduktion */
async function readReduction(tx: Tx, companyId: number, invoiceId: number | null, input: Record<string, unknown>, lines: InvoiceLineInput[], t: ReturnType<typeof computeInvoice>, rc: boolean, invoiceDate: string) {
  const type = (str(input, 'reduction_type') || null) as ReductionType | null;
  if (type && !(type in REDUCTION)) throw new ValidationError('Ogiltig typ av skattereduktion');
  if (!type) return { reduction_type: null, tax_reduction: 0, reduction_max: null, buyer_pnr: '', property: '', brf_orgnr: '', apartment_no: '', work_type: '' };
  if (rc) throw new ValidationError('ROT/RUT gäller privatpersoner – kunden har omvänd skattskyldighet');
  const pnr = normalizePersonalNumber(str(input, 'buyer_pnr')) ?? str(input, 'buyer_pnr');
  const max = optInt(input, 'reduction_max', 'Kvar av köparens tak');
  const used = normalizePersonalNumber(pnr) ? await usedByBuyer(tx, companyId, pnr, invoiceDate.slice(0, 4), invoiceId) : { rot: 0, rut: 0 };
  const remaining = Math.min(remainingForBuyer(type, used), max ?? Infinity);
  const r = computeReduction(type, labourInclVat(lines, t, rc), remaining);
  return {
    reduction_type: type, tax_reduction: r.reduction, reduction_max: max, buyer_pnr: pnr, property: str(input, 'property'),
    brf_orgnr: str(input, 'brf_orgnr'), apartment_no: str(input, 'apartment_no'), work_type: str(input, 'work_type'),
  };
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
    const [inv] = await tx<{ status: string; invoice_date: string; reverse_charge: boolean; customer: string; reduction_type: ReductionType | null; tax_reduction: number;
      reduction_max: number | null; buyer_pnr: string; property: string; brf_orgnr: string; apartment_no: string; work_type: string; f_skatt: boolean }[]>`
      SELECT i.status, to_char(i.invoice_date,'YYYY-MM-DD') AS invoice_date, i.reverse_charge, c.name AS customer, i.reduction_type, i.tax_reduction, i.reduction_max,
        i.buyer_pnr, i.property, i.brf_orgnr, i.apartment_no, i.work_type, co.f_skatt
      FROM invoices i JOIN customers c ON c.id = i.customer_id JOIN companies co ON co.id = i.company_id WHERE i.id = ${invoiceId} AND i.company_id = ${actor.companyId} FOR UPDATE OF i`;
    if (!inv) throw new NotFoundError('Fakturan');
    if (inv.status !== 'draft') throw new ConflictError('Fakturan är redan bokförd');
    const lines = await loadLines(tx, invoiceId);
    const t = computeInvoice(lines, { reverseCharge: inv.reverse_charge });
    let reduction = 0;
    if (inv.reduction_type) {
      const labour = labourInclVat(lines, t, inv.reverse_charge);
      const errs = reductionErrors({ type: inv.reduction_type, buyerPnr: inv.buyer_pnr, property: inv.property, brfOrgnr: inv.brf_orgnr, apartmentNo: inv.apartment_no, workType: inv.work_type },
        { labour, fSkatt: inv.f_skatt, pnrValid: !!normalizePersonalNumber(inv.buyer_pnr) });
      if (errs.length) throw new ValidationError(errs.join('. '));
      // Räkna om mot köparens tak vid bokföringen (andra fakturor kan ha bokförts sedan utkastet sparades)
      const used = await usedByBuyer(tx, actor.companyId, inv.buyer_pnr, inv.invoice_date.slice(0, 4), invoiceId);
      reduction = computeReduction(inv.reduction_type, labour, Math.min(remainingForBuyer(inv.reduction_type, used), inv.reduction_max ?? Infinity)).reduction;
      await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${ACC.taxReductionReceivable}, 'Kundfordringar – delad faktura (ROT/RUT)') ON CONFLICT DO NOTHING`;
    }
    const no = await nextInvoiceNumber(tx, actor.companyId);
    // En faktura på 0 kr (t.ex. timbanksavräkning utan övertid) bokförs inte och är direkt reglerad
    const zero = t.total === 0 && t.net === 0;
    const v = zero || (await accountingMethod(tx, actor.companyId)) === 'cash' ? null : await createVoucher(tx, {
      actor, date: inv.invoice_date, description: `Kundfaktura ${no}, ${inv.customer}`,
      lines: invoiceBookingLines(lines, t, 1, reduction), sourceType: 'invoice', sourceId: invoiceId, series: 'B',
    });
    await tx`UPDATE invoices SET status = ${zero ? 'paid' : 'booked'}, paid_date = ${zero ? inv.invoice_date : null}, invoice_number = ${no}, ocr = ${makeOcr(no)}, voucher_id = ${v?.id ?? null},
      total_net = ${t.net}, total_vat = ${t.vat}, rounding = ${t.rounding}, total = ${t.total - reduction}, tax_reduction = ${reduction} WHERE id = ${invoiceId}`;
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
  const [inv] = await tx<{ status: string; total: number; invoice_number: number; voucher_id: number | null; reverse_charge: boolean; customer: string; tax_reduction: number; reduction_type: string | null }[]>`
    SELECT i.status, i.total, i.invoice_number, i.voucher_id, i.reverse_charge, c.name AS customer, i.tax_reduction, i.reduction_type
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
    return replaceAccount(invoiceBookingLines(il, computeInvoice(il, { reverseCharge: inv.reverse_charge }), 1, inv.tax_reduction), ACC.customerReceivables, bank);
  })();
  const v = await createVoucher(tx, {
    actor, date: d, description: inv.voucher_id ? `Inbetalning kundfaktura ${inv.invoice_number}` : `Inbetalning kundfaktura ${inv.invoice_number}, ${inv.customer} (kontantmetoden)`,
    lines, sourceType: 'invoice_payment', sourceId: invoiceId, series: 'B',
  });
  // ROT/RUT: när kunden har betalat sin del kan företaget begära resten från Skatteverket
  await tx`UPDATE invoices SET status = 'paid', paid_date = ${d}, payment_voucher_id = ${v.id},
    reduction_status = ${inv.reduction_type && inv.tax_reduction > 0 ? 'to_request' : null} WHERE id = ${invoiceId}`;
  await auditBy(tx, actor, 'paid', 'invoice', invoiceId);
  const out = await fetchInvoice(tx, actor.companyId, invoiceId);
  await emit(tx, actor.companyId, 'invoice.paid', out);
  return out;
}

/** Kreditera en bokförd, obetald faktura. Returnerar kreditfakturan. */
export async function creditInvoice(actor: Actor, invoiceId: number, input: Record<string, unknown>): Promise<InvoiceOut> {
  return sql.begin(async (tx) => {
    const [inv] = await tx<{ status: string; customer_id: number; invoice_number: number; reverse_charge: boolean; customer: string; voucher_id: number | null; total: number; tax_reduction: number }[]>`
      SELECT i.status, i.customer_id, i.invoice_number, i.reverse_charge, c.name AS customer, i.voucher_id, i.total, i.tax_reduction
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
      total_net: t.net, total_vat: t.vat, rounding: t.rounding, total: t.total + inv.tax_reduction, credit_of_id: invoiceId, paid_date: d, tax_reduction: -inv.tax_reduction,
    })} RETURNING id`;
    await tx`INSERT INTO invoice_lines ${tx(lines.map((l, i) => ({
      invoice_id: creditId, position: i + 1, description: l.description, quantity: l.quantity, unit: l.unit,
      unit_price: l.unitPrice, vat_rate: l.vatRate, account_number: l.account, labor: !!l.labor,
    })))}`;
    // Negativa antal ger negativa belopp → konteringen vänder automatiskt sidorna.
    // Kontantmetoden: originalet är aldrig bokfört, så krediteringen bokförs inte heller.
    if (inv.voucher_id) {
      const v = await createVoucher(tx, {
        actor, date: d, description: `Kreditfaktura ${no} (kreditering av ${inv.invoice_number}), ${inv.customer}`,
        lines: invoiceBookingLines(lines, t, 1, -inv.tax_reduction), sourceType: 'invoice', sourceId: creditId, series: 'B',
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
  const open = await tx<{ id: number; invoice_number: number; reverse_charge: boolean; customer: string; tax_reduction: number }[]>`
    SELECT i.id, i.invoice_number, i.reverse_charge, c.name AS customer, i.tax_reduction FROM invoices i JOIN customers c ON c.id = i.customer_id
    WHERE i.company_id = ${actor.companyId} AND i.status = 'booked' AND i.voucher_id IS NULL AND i.invoice_date <= ${endDate}
    ORDER BY i.invoice_number FOR UPDATE OF i`;
  for (const inv of open) {
    const lines = await loadLines(tx, inv.id);
    const v = await createVoucher(tx, {
      actor, date: endDate, description: `Obetald kundfaktura ${inv.invoice_number}, ${inv.customer} – per bokslutsdagen`,
      lines: invoiceBookingLines(lines, computeInvoice(lines, { reverseCharge: inv.reverse_charge }), 1, inv.tax_reduction), sourceType: 'invoice', sourceId: inv.id, series: 'B',
    });
    await tx`UPDATE invoices SET voucher_id = ${v.id} WHERE id = ${inv.id}`;
    await auditBy(tx, actor, 'book_yearend', 'invoice', inv.id);
  }
  return open.length;
}
