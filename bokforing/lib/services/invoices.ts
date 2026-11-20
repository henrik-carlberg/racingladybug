import 'server-only';
import { OSS_RATES, OSS_SALES_ACCOUNT, OSS_VAT_ACCOUNT, ossCountry } from '@/lib/oss';
import { notify } from './push';
import { enqueue } from '@/lib/server/jobs';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { createVoucher } from '@/lib/server/ledger';
import { auditBy } from '@/lib/server/audit';
import { emit } from '@/lib/server/events';
import { loadLines } from '@/lib/server/invoices';
import { proportionalLines } from '@/lib/partial';
import { computeInvoice, CURRENCIES, defaultSalesAccount, fxPaymentLines, invoiceBookingLines, invoicePaymentLines, invoiceTotals, isForeign, lineNet, type InvoiceLineInput } from '@/lib/invoice';
import { makeOcr, normalizePersonalNumber } from '@/lib/validate';
import { computeReduction, labourInclVat, reductionErrors, remainingForBuyer, REDUCTION, type ReductionType } from '@/lib/rotrut';
import { replaceAccount, type Line } from '@/lib/ledger-lines';

/** Intäktsrader på en faktura från ett uppdrag får projektet som dimension */
const tagProject = (lines: Line[], projectId: number | null | undefined): Line[] =>
  projectId ? lines.map((l) => (l.account >= 3000 && l.account <= 3999 ? { ...l, projectId } : l)) : lines;
import { ACC } from '@/lib/bas';
import { addDays } from '@/lib/format';
import type { Actor } from './actor';
import { arr, date, int, list, optInt, str, type Page } from './input';

export interface InvoiceOut {
  id: number; object: 'invoice'; number: number | null; status: 'draft' | 'booked' | 'paid' | 'credited';
  customer_id: number; customer_name: string; invoice_date: string; due_date: string; delivery_date: string;
  ocr: string | null; our_reference: string; your_reference: string; notes: string; reverse_charge: boolean; currency: string; exchange_rate: number; total_currency: number | null; language: 'sv' | 'en'; fx_result: number;
  total_net: number; total_vat: number; rounding: number; total: number; paid_date: string | null;
  credit_of_id: number | null; voucher_id: number | null; payment_voucher_id: number | null; created_at: string;
  reduction_type: ReductionType | null; tax_reduction: number; buyer_pnr: string; property: string; brf_orgnr: string; apartment_no: string; work_type: string;
  reduction_status: string | null; paid_amount: number; advance: boolean;
  lines: { description: string; quantity: number; unit: string; unit_price: number; vat_rate: number; account: number; amount: number; labor: boolean }[];
}

async function fetchInvoice(db: Tx | typeof sql, companyId: number, id: number): Promise<InvoiceOut> {
  const [i] = await db<Omit<InvoiceOut, 'lines' | 'object'>[]>`
    SELECT i.id, i.invoice_number AS number, i.status, i.customer_id, c.name AS customer_name,
      to_char(i.invoice_date,'YYYY-MM-DD') AS invoice_date, to_char(i.due_date,'YYYY-MM-DD') AS due_date, i.delivery_date,
      i.ocr, i.our_reference, i.your_reference, i.notes, i.reverse_charge, i.total_net, i.total_vat, i.rounding, i.total,
      to_char(i.paid_date,'YYYY-MM-DD') AS paid_date, i.credit_of_id, i.voucher_id, i.payment_voucher_id, i.created_at,
      i.reduction_type, i.tax_reduction, i.buyer_pnr, i.property, i.brf_orgnr, i.apartment_no, i.work_type, i.reduction_status, i.paid_amount, i.advance,
      i.currency, i.exchange_rate::float8 AS exchange_rate, i.total_currency, i.language, i.fx_result
    FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ${id} AND i.company_id = ${companyId}`;
  if (!i) throw new NotFoundError('Fakturan');
  const lines = await loadLines(db, id);
  return {
    ...i, object: 'invoice',
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

function parseLines(input: Record<string, unknown>, reverseCharge: boolean, construction = false): InvoiceLineInput[] {
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
      account: optInt(r, 'account', `${label}: konto`) ?? (construction ? ACC.salesConstructionRc : defaultSalesAccount(vatRate, reverseCharge)),
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
  const [company] = await tx<{ invoice_terms: number; oss: boolean }[]>`SELECT invoice_terms, oss_registered AS oss FROM companies WHERE id = ${actor.companyId}`;
  const customerId = int(input, 'customer_id', 'Kund');
  const [cust] = await tx<{ reverse_charge: boolean; construction_rc: boolean; vat_number: string; orgnr: string; payment_terms: number | null; currency: string; language: string; country: string }[]>`
    SELECT reverse_charge, construction_rc, vat_number, orgnr, payment_terms, currency, language, country FROM customers WHERE id = ${customerId} AND company_id = ${actor.companyId}`;
  if (!cust) throw new ValidationError('Kunden finns inte');
  // Omvänd skattskyldighet: tjänster till EU-företag, eller byggtjänster till byggföretag i Sverige
  const rcKind = cust.reverse_charge ? 'eu' : cust.construction_rc ? 'construction' : '';
  const rcOn = !!rcKind;
  if (rcKind === 'construction' && !cust.vat_number && !cust.orgnr) throw new ValidationError('Omvänd byggmoms kräver köparens momsregistreringsnummer eller organisationsnummer');
  const lines = parseLines(input, rcOn, rcKind === 'construction');
  // OSS: privatperson i annat EU-land och bolaget registrerat för OSS – köparlandets moms på momspliktiga rader
  const oss = ossCountry({ registered: company.oss, country: cust.country, vatNumber: cust.vat_number, reverseCharge: rcOn });
  if (oss) {
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${OSS_SALES_ACCOUNT}, 'Försäljning till privatpersoner i andra EU-länder (OSS)'),
      (${actor.companyId}, ${OSS_VAT_ACCOUNT}, 'Utgående moms OSS') ON CONFLICT DO NOTHING`;
    for (const l of lines) if (l.vatRate !== 0) {
      l.ossRate = OSS_RATES[oss];
      if (l.account === defaultSalesAccount(l.vatRate, false)) l.account = OSS_SALES_ACCOUNT;
    }
  }
  const advance = input.advance === true || input.advance === 'true' || input.advance === 'on';
  if (advance) {
    if (str(input, 'reduction_type')) throw new ValidationError('En förskottsfaktura kan inte ha ROT/RUT – lägg avdraget på slutfakturan');
    for (const l of lines) if (l.account < 2000 || l.account >= 3000) l.account = ACC.customerAdvances;
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${ACC.customerAdvances}, 'Förskott från kunder') ON CONFLICT DO NOTHING`;
  }
  const invoiceDate = date(input, 'invoice_date', 'Fakturadatum');
  const dueDate = date(input, 'due_date', 'Förfallodatum', false) || addDays(invoiceDate, cust.payment_terms ?? company.invoice_terms);
  const currency = (str(input, 'currency') || cust.currency || 'SEK').toUpperCase();
  if (!(CURRENCIES as readonly string[]).includes(currency)) throw new ValidationError(`Valuta stöds inte: ${currency}`);
  const language = (str(input, 'language') || cust.language) === 'en' ? 'en' : 'sv';
  let rate = 1;
  if (isForeign(currency)) {
    rate = Number(String(input.exchange_rate ?? '').replace(',', '.'));
    if (!Number.isFinite(rate) || rate <= 0 || rate > 1000) throw new ValidationError(`Ange växelkursen (kronor per ${currency})`);
    rate = Math.round(rate * 1e6) / 1e6;
    if (advance) throw new ValidationError('Förskottsfakturor i utländsk valuta stöds inte');
    if (str(input, 'reduction_type')) throw new ValidationError('ROT/RUT kan inte kombineras med utländsk valuta');
    if (await accountingMethod(tx, actor.companyId) === 'cash') throw new ValidationError('Fakturor i utländsk valuta kräver faktureringsmetoden');
  }
  const tt = invoiceTotals(lines, { reverseCharge: rcOn, currency, rate });
  const t = tt.sek;
  const rr = await readReduction(tx, actor.companyId, invoiceId, input, lines, t, rcOn, invoiceDate);
  const head = {
    customer_id: customerId, invoice_date: invoiceDate, due_date: dueDate, delivery_date: str(input, 'delivery_date'),
    our_reference: str(input, 'our_reference'), your_reference: str(input, 'your_reference'), notes: str(input, 'notes'),
    reverse_charge: rcOn, rc_kind: rcKind, oss_country: oss, advance, currency, exchange_rate: rate, language, total_currency: tt.foreign ? tt.doc.total : null, total_net: t.net, total_vat: t.vat, rounding: t.rounding, total: t.total - rr.tax_reduction, ...rr,
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
      unit_price: l.unitPrice, vat_rate: l.vatRate, account_number: l.account, labor: !!l.labor, oss_rate: l.ossRate ?? null,
    })))}`;
    await auditBy(tx, actor, invoiceId ? 'update_draft' : 'create_draft', 'invoice', id);
    const out = await fetchInvoice(tx, actor.companyId, id);
    await emit(tx, actor.companyId, invoiceId ? 'invoice.updated' : 'invoice.created', out);
    return out;
  }
}

/** Förskottsfakturor till kunden som är betalda och ännu inte avräknade */
export async function openAdvances(db: Tx | typeof sql, companyId: number, customerId: number) {
  return db<{ id: number; invoice_number: number; total_net: number; total: number; invoice_date: string }[]>`
    SELECT id, invoice_number, total_net, total, to_char(invoice_date,'YYYY-MM-DD') AS invoice_date FROM invoices
    WHERE company_id = ${companyId} AND customer_id = ${customerId} AND advance AND status = 'paid' AND advance_settled_by IS NULL AND credit_of_id IS NULL
    ORDER BY invoice_date, id`;
}

/** Avräkna en betald förskottsfaktura på ett fakturautkast: en negativ rad mot 2420 per momssats */
export async function settleAdvance(actor: Actor, draftId: number, advanceId: number): Promise<InvoiceOut> {
  return sql.begin(async (tx) => {
    const [d] = await tx<{ customer_id: number; status: string; advance: boolean; reduction_type: string | null; reverse_charge: boolean; currency: string }[]>`
      SELECT customer_id, status, advance, reduction_type, reverse_charge, currency FROM invoices WHERE id = ${draftId} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!d) throw new NotFoundError('Fakturan');
    if (d.status !== 'draft') throw new ConflictError('Förskott kan bara avräknas på ett utkast');
    if (d.advance) throw new ConflictError('En förskottsfaktura kan inte avräkna andra förskott');
    if (d.reduction_type) throw new ConflictError('Avräkna förskottet innan du lägger till ROT/RUT');
    if (isForeign(d.currency)) throw new ConflictError('Förskott kan inte avräknas på en faktura i utländsk valuta');
    const [a] = await tx<{ invoice_number: number }[]>`SELECT invoice_number FROM invoices WHERE id = ${advanceId} AND company_id = ${actor.companyId}
      AND customer_id = ${d.customer_id} AND advance AND status = 'paid' AND advance_settled_by IS NULL AND credit_of_id IS NULL FOR UPDATE`;
    if (!a) throw new ValidationError('Förskottsfakturan finns inte, är inte betald eller är redan avräknad');
    const advLines = await loadLines(tx, advanceId);
    const byRate = new Map<number, number>();
    for (const l of advLines) byRate.set(l.vatRate, (byRate.get(l.vatRate) ?? 0) + lineNet(l));
    const lines = await loadLines(tx, draftId);
    for (const [rate, net] of byRate) if (net) lines.push({
      description: `Avgår förskott enligt faktura ${a.invoice_number}${byRate.size > 1 ? ` (${rate} % moms)` : ''}`,
      quantity: -1, unit: 'st', unitPrice: net, vatRate: rate as InvoiceLineInput['vatRate'], account: ACC.customerAdvances, labor: false,
    });
    const t = computeInvoice(lines, { reverseCharge: d.reverse_charge });
    if (t.total < 0) throw new ValidationError('Förskottet är större än fakturan');
    await tx`DELETE FROM invoice_lines WHERE invoice_id = ${draftId}`;
    await tx`INSERT INTO invoice_lines ${tx(lines.map((l, i) => ({
      invoice_id: draftId, position: i + 1, description: l.description, quantity: l.quantity, unit: l.unit,
      unit_price: l.unitPrice, vat_rate: l.vatRate, account_number: l.account, labor: !!l.labor,
    })))}`;
    await tx`UPDATE invoices SET total_net = ${t.net}, total_vat = ${t.vat}, rounding = ${t.rounding}, total = ${t.total} WHERE id = ${draftId}`;
    await tx`UPDATE invoices SET advance_settled_by = ${draftId} WHERE id = ${advanceId}`;
    await auditBy(tx, actor, 'settle_advance', 'invoice', draftId, { advance_id: advanceId });
    const out = await fetchInvoice(tx, actor.companyId, draftId);
    await emit(tx, actor.companyId, 'invoice.updated', out);
    return out;
  });
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
      reduction_max: number | null; buyer_pnr: string; property: string; brf_orgnr: string; apartment_no: string; work_type: string; f_skatt: boolean; project_id: number | null; currency: string; exchange_rate: string }[]>`
      SELECT i.status, to_char(i.invoice_date,'YYYY-MM-DD') AS invoice_date, i.reverse_charge, i.currency, i.exchange_rate, c.name AS customer, i.reduction_type, i.tax_reduction, i.reduction_max, i.project_id,
        i.buyer_pnr, i.property, i.brf_orgnr, i.apartment_no, i.work_type, co.f_skatt
      FROM invoices i JOIN customers c ON c.id = i.customer_id JOIN companies co ON co.id = i.company_id WHERE i.id = ${invoiceId} AND i.company_id = ${actor.companyId} FOR UPDATE OF i`;
    if (!inv) throw new NotFoundError('Fakturan');
    if (inv.status !== 'draft') throw new ConflictError('Fakturan är redan bokförd');
    const lines = await loadLines(tx, invoiceId);
    const tt = invoiceTotals(lines, { reverseCharge: inv.reverse_charge, currency: inv.currency, rate: inv.exchange_rate });
    const t = tt.sek;
    // Kreditkontroll: kreditgräns och riskklass (stoppar om kunden har policy "stoppa")
    { const [ci] = await tx<{ customer_id: number }[]>`SELECT customer_id FROM invoices WHERE id = ${invoiceId}`; const { creditGuard } = await import('./credit'); await creditGuard(tx, actor.companyId, ci.customer_id, t.total); }
    if (tt.foreign && (await accountingMethod(tx, actor.companyId)) === 'cash') throw new ValidationError('Fakturor i utländsk valuta kräver faktureringsmetoden');
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
      lines: tagProject(invoiceBookingLines(lines, t, 1, reduction), inv.project_id), sourceType: 'invoice', sourceId: invoiceId, series: 'B',
    });
    await tx`UPDATE invoices SET status = ${zero ? 'paid' : 'booked'}, paid_date = ${zero ? inv.invoice_date : null}, invoice_number = ${no}, ocr = ${makeOcr(no)}, voucher_id = ${v?.id ?? null},
      total_net = ${t.net}, total_vat = ${t.vat}, rounding = ${t.rounding}, total = ${t.total - reduction}, tax_reduction = ${reduction}, total_currency = ${tt.foreign ? tt.doc.total : null} WHERE id = ${invoiceId}`;
    await auditBy(tx, actor, 'book', 'invoice', invoiceId, { number: no });
    const out = await fetchInvoice(tx, actor.companyId, invoiceId);
    await emit(tx, actor.companyId, 'invoice.booked', out);
    return out;
  }).then(async (out) => {
    // Faktura till ett koncernbolag blir en leverantörsfaktura hos mottagaren
    const { mirrorInvoice } = await import('./intercompany');
    await mirrorInvoice(actor.companyId, invoiceId).catch((e) => console.error('koncernfaktura', e instanceof Error ? e.message : e));
    // Faktura med tjänsteperiod (t.ex. årsabonnemang) periodiseras via förutbetalda intäkter
    const { deferIfNeeded } = await import('./revenue');
    await deferIfNeeded(actor, invoiceId).catch((e) => console.error('periodisering', e instanceof Error ? e.message : e));
    return out;
  });
}

export async function deleteDraft(actor: Actor, invoiceId: number) {
  await sql.begin(async (tx) => {
    const out = await fetchInvoice(tx, actor.companyId, invoiceId);
    if (out.status !== 'draft') throw new ConflictError('Endast utkast kan tas bort');
    // Utkastet kan vara restfaktura för ROT/RUT på en annan faktura: kopplingen tas bort, inte den andra fakturan
    await tx`UPDATE invoices SET reduction_rest_invoice_id = NULL WHERE reduction_rest_invoice_id = ${invoiceId} AND company_id = ${actor.companyId}`;
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
  const [inv] = await tx<{ status: string; total: number; paid_amount: number; invoice_number: number; voucher_id: number | null; imported: boolean; currency: string; reverse_charge: boolean; customer: string; tax_reduction: number; reduction_type: string | null; project_id: number | null }[]>`
    SELECT i.status, i.total, i.paid_amount, i.invoice_number, i.voucher_id, i.imported, i.currency, i.reverse_charge, c.name AS customer, i.tax_reduction, i.reduction_type, i.project_id
    FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ${invoiceId} AND i.company_id = ${actor.companyId} FOR UPDATE OF i`;
  if (!inv) throw new NotFoundError('Fakturan');
  if (inv.status !== 'booked') throw new ConflictError('Endast bokförda, obetalda fakturor kan registreras som betalda');
  const total = Number(inv.total), paidBefore = Number(inv.paid_amount);
  const remaining = total - paidBefore;
  const amount = optInt(input, 'amount', 'Belopp') ?? remaining;
  if (amount <= 0) throw new ValidationError('Beloppet måste vara större än noll');
  if (isForeign(inv.currency)) return registerFxPayment(tx, actor, invoiceId, inv, remaining, amount, input);
  if (amount > remaining) throw new ValidationError(`Beloppet är större än det som återstår att betala (${(remaining / 100).toFixed(2).replace('.', ',')} kr)`);
  const d = date(input, 'date', 'Betaldatum');
  const bank = optInt(input, 'bank_account', 'Bankkonto') ?? 1930;
  if ((bank < 1900 || bank > 1999) && bank !== ACC.cardClearing && bank !== 1689) throw new ValidationError('Bankkonto måste vara ett 19xx-konto');
  const full = paidBefore + amount === total;
  // Kontantmetoden: fakturan är inte bokförd än – intäkt och moms bokförs vid betalningen, vid delbetalning med betalningens andel
  const lines = inv.voucher_id || inv.imported ? invoicePaymentLines(amount, bank) : await (async () => {
    const il = await loadLines(tx, invoiceId);
    const booking = tagProject(invoiceBookingLines(il, computeInvoice(il, { reverseCharge: inv.reverse_charge }), 1, inv.tax_reduction), inv.project_id);
    return proportionalLines(booking, total, paidBefore, amount, ACC.customerReceivables, bank);
  })();
  const v = await createVoucher(tx, {
    actor, date: d, description: `${full && !paidBefore ? 'Inbetalning' : full ? 'Slutbetalning' : 'Delbetalning'} kundfaktura ${inv.invoice_number}${inv.voucher_id || inv.imported ? '' : `, ${inv.customer} (kontantmetoden)`}`,
    lines, sourceType: 'invoice_payment', sourceId: invoiceId, series: 'B',
  });
  await tx`INSERT INTO invoice_payments (company_id, invoice_id, date, amount, voucher_id) VALUES (${actor.companyId}, ${invoiceId}, ${d}, ${amount}, ${v.id})`;
  // ROT/RUT: när kunden har betalat hela sin del kan företaget begära resten från Skatteverket
  await tx`UPDATE invoices SET paid_amount = paid_amount + ${amount}, payment_voucher_id = ${v.id},
    status = ${full ? 'paid' : 'booked'}, paid_date = ${full ? d : null},
    reduction_status = ${full && inv.reduction_type && inv.tax_reduction > 0 ? 'to_request' : null} WHERE id = ${invoiceId}`;
  await auditBy(tx, actor, full ? 'paid' : 'partly_paid', 'invoice', invoiceId, { amount });
  const out = await fetchInvoice(tx, actor.companyId, invoiceId);
  await emit(tx, actor.companyId, full ? 'invoice.paid' : 'invoice.partly_paid', out);
  notify.paid(actor.companyId, inv.customer, inv.invoice_number, amount, invoiceId);
  if (full) await enqueue('mail.thanks', { companyId: actor.companyId, invoiceId }, tx);
  return out;
}

/** Utländsk valuta: inbetalt belopp i kronor reglerar hela fordran; skillnaden bokförs som kursvinst/-förlust */
async function registerFxPayment(tx: Tx, actor: Actor, invoiceId: number, inv: { invoice_number: number; customer: string; currency: string }, remaining: number, received: number, input: Record<string, unknown>) {
  if (received < remaining * 0.8 || received > remaining * 1.2) throw new ValidationError(`Inbetalt belopp avviker mer än 20 % från fordran (${(remaining / 100).toFixed(2).replace('.', ',')} kr). Delbetalning stöds inte för fakturor i ${inv.currency}.`);
  const d = date(input, 'date', 'Betaldatum');
  const bank = optInt(input, 'bank_account', 'Bankkonto') ?? 1930;
  if ((bank < 1900 || bank > 1999) && bank !== ACC.cardClearing && bank !== 1689) throw new ValidationError('Bankkonto måste vara ett 19xx-konto');
  await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, 3960, 'Valutakursvinster på fordringar och skulder av rörelsekaraktär'), (${actor.companyId}, 7960, 'Valutakursförluster på fordringar och skulder av rörelsekaraktär') ON CONFLICT DO NOTHING`;
  const v = await createVoucher(tx, {
    actor, date: d, description: `Inbetalning kundfaktura ${inv.invoice_number} (${inv.currency}), ${inv.customer}`,
    lines: fxPaymentLines(remaining, received, bank), sourceType: 'invoice_payment', sourceId: invoiceId, series: 'B',
  });
  await tx`INSERT INTO invoice_payments (company_id, invoice_id, date, amount, voucher_id) VALUES (${actor.companyId}, ${invoiceId}, ${d}, ${remaining}, ${v.id})`;
  await tx`UPDATE invoices SET paid_amount = total, payment_voucher_id = ${v.id}, status = 'paid', paid_date = ${d}, fx_result = ${received - remaining} WHERE id = ${invoiceId}`;
  await auditBy(tx, actor, 'paid', 'invoice', invoiceId, { received, fx: received - remaining });
  const out = await fetchInvoice(tx, actor.companyId, invoiceId);
  await emit(tx, actor.companyId, 'invoice.paid', out);
  notify.paid(actor.companyId, inv.customer, inv.invoice_number, received, invoiceId);
  return out;
}

/** Kreditera en bokförd, obetald faktura. Returnerar kreditfakturan. */
export async function creditInvoice(actor: Actor, invoiceId: number, input: Record<string, unknown>): Promise<InvoiceOut> {
  return sql.begin(async (tx) => {
    const [inv] = await tx<{ status: string; customer_id: number; invoice_number: number; reverse_charge: boolean; customer: string; voucher_id: number | null; total: number; tax_reduction: number; project_id: number | null; currency: string; exchange_rate: string; language: string; rc_kind: string }[]>`
      SELECT i.status, i.customer_id, i.invoice_number, i.reverse_charge, c.name AS customer, i.voucher_id, i.total, i.tax_reduction, i.project_id, i.currency, i.exchange_rate, i.language, i.rc_kind
      FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ${invoiceId} AND i.company_id = ${actor.companyId} FOR UPDATE OF i`;
    if (!inv) throw new NotFoundError('Fakturan');
    if (inv.status !== 'booked' && !(inv.status === 'paid' && inv.total === 0)) throw new ConflictError('Endast bokförda, obetalda fakturor kan krediteras');
    const [{ paid, imported }] = await tx<{ paid: number; imported: boolean }[]>`SELECT paid_amount AS paid, imported FROM invoices WHERE id = ${invoiceId}`;
    if (imported) throw new ConflictError('En importerad faktura krediteras i det tidigare systemet eller med en manuell verifikation mot 1510');
    if (Number(paid) > 0) throw new ConflictError('Fakturan är delbetald. Gör en kreditfaktura på resterande belopp manuellt eller registrera resten som betalt.');
    const lines = (await loadLines(tx, invoiceId)).map((l) => ({ ...l, quantity: -l.quantity }));
    // Krediteringen bokförs till samma kurs som fakturan, så att fordran nollställs exakt
    const tt = invoiceTotals(lines, { reverseCharge: inv.reverse_charge, currency: inv.currency, rate: inv.exchange_rate });
    const t = tt.foreign ? { ...tt.sek, total: -Number(inv.total), rounding: -Number(inv.total) - tt.sek.net - tt.sek.vat } : tt.sek;
    const d = date(input, 'date', 'Datum');
    const no = await nextInvoiceNumber(tx, actor.companyId);
    const [{ id: creditId }] = await tx<{ id: number }[]>`INSERT INTO invoices ${tx({
      company_id: actor.companyId, customer_id: inv.customer_id, invoice_number: no, invoice_date: d, due_date: d,
      status: 'paid', notes: `Kreditering av faktura ${inv.invoice_number}`, reverse_charge: inv.reverse_charge,
      total_net: t.net, total_vat: t.vat, rounding: t.rounding, total: t.total + inv.tax_reduction, credit_of_id: invoiceId, paid_date: d, tax_reduction: -inv.tax_reduction,
      currency: inv.currency, exchange_rate: inv.exchange_rate, language: inv.language, total_currency: tt.foreign ? tt.doc.total : null, rc_kind: inv.rc_kind,
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
        lines: tagProject(invoiceBookingLines(lines, t, 1, -inv.tax_reduction), inv.project_id), sourceType: 'invoice', sourceId: creditId, series: 'B',
      });
      await tx`UPDATE invoices SET voucher_id = ${v.id} WHERE id = ${creditId}`;
    }
    await tx`UPDATE invoices SET status = 'credited' WHERE id = ${invoiceId}`;
    // Förskott som avräknats på den krediterade fakturan kan avräknas igen
    await tx`UPDATE invoices SET advance_settled_by = NULL WHERE advance_settled_by = ${invoiceId}`;
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
  const open = await tx<{ id: number; invoice_number: number; reverse_charge: boolean; customer: string; tax_reduction: number; project_id: number | null; total: number; paid_amount: number }[]>`
    SELECT i.id, i.invoice_number, i.reverse_charge, c.name AS customer, i.tax_reduction, i.project_id, i.total, i.paid_amount FROM invoices i JOIN customers c ON c.id = i.customer_id
    WHERE i.company_id = ${actor.companyId} AND i.status = 'booked' AND i.voucher_id IS NULL AND NOT i.imported AND i.invoice_date <= ${endDate}
    ORDER BY i.invoice_number FOR UPDATE OF i`;
  for (const inv of open) {
    const lines = await loadLines(tx, inv.id);
    const v = await createVoucher(tx, {
      actor, date: endDate, description: `Obetald kundfaktura ${inv.invoice_number}, ${inv.customer} – per bokslutsdagen`,
      lines: (() => {
        const booking = tagProject(invoiceBookingLines(lines, computeInvoice(lines, { reverseCharge: inv.reverse_charge }), 1, inv.tax_reduction), inv.project_id);
        // Delbetald: bara den obetalda andelen bokförs
        const paid = Number(inv.paid_amount), total = Number(inv.total);
        return paid > 0 ? proportionalLines(booking, total, paid, total - paid, ACC.customerReceivables, ACC.customerReceivables) : booking;
      })(), sourceType: 'invoice', sourceId: inv.id, series: 'B',
    });
    await tx`UPDATE invoices SET voucher_id = ${v.id} WHERE id = ${inv.id}`;
    await auditBy(tx, actor, 'book_yearend', 'invoice', inv.id);
  }
  return open.length;
}
