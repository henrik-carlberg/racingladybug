import 'server-only';
import { rememberCoding } from './coding-memory';
import { notify } from './push';
import { vatRateOf } from '@/lib/coding-memory';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { createVoucher } from '@/lib/server/ledger';
import { auditBy } from '@/lib/server/audit';
import { emit } from '@/lib/server/events';
import { supplierInvoiceLines, supplierPaymentLines, type CostLine } from '@/lib/supplier';
import { replaceAccount } from '@/lib/ledger-lines';
import { proportionalLines } from '@/lib/partial';
import { ACC } from '@/lib/bas';
import { CURRENCIES, fxPaymentLines, isForeign } from '@/lib/invoice';
import { attestError, requiredApprovals } from '@/lib/attest';
import type { Actor } from './actor';
import { arr, date, has, int, list, optInt, ore, str, type Page } from './input';
import { insertAttachment, type AttachmentIn } from './vouchers';
import { dimId } from './dimensions';
import { BANK_FIELDS, bankChanges } from '@/lib/fraud';
import { blockedInvoices, checkDuplicate, checkPriceIncrease, requestBankChange } from './fraud';

// ---------- Leverantörer ----------

export interface SupplierOut {
  id: number; object: 'supplier'; name: string; orgnr: string; bankgiro: string; plusgiro: string; bank_account: string;
  default_account: number; email: string; created_at: string; cost_center_id: number | null;
}
const SCOLS = () => sql`id, 'supplier' AS object, name, orgnr, bankgiro, plusgiro, bank_account, default_account, email, created_at, cost_center_id`;

export async function getSupplier(companyId: number, id: number): Promise<SupplierOut> {
  const [s] = await sql<SupplierOut[]>`SELECT ${SCOLS()} FROM suppliers WHERE id = ${id} AND company_id = ${companyId}`;
  if (!s) throw new NotFoundError('Leverantören');
  return s;
}

export async function listSuppliers(companyId: number, p: Page) {
  const rows = await sql<SupplierOut[]>`SELECT ${SCOLS()} FROM suppliers WHERE company_id = ${companyId}
    ${p.startingAfter ? sql`AND id > ${p.startingAfter}` : sql``} ORDER BY id LIMIT ${p.limit + 1}`;
  return list([...rows], p);
}

function readSupplier(input: Record<string, unknown>, partial: boolean) {
  const f: Record<string, unknown> = {};
  for (const k of ['name', 'orgnr', 'bankgiro', 'plusgiro', 'bank_account', 'email', 'default_account']) {
    if (partial && !has(input, k)) continue;
    if (k === 'default_account') f[k] = optInt(input, k, 'Standardkonto') ?? 4010;
    else f[k] = str(input, k, { required: k === 'name', label: k === 'name' ? 'Namn' : k });
  }
  if (!partial || has(input, 'cost_center_id')) f.cost_center_id = dimId(input.cost_center_id);
  return f;
}

export async function createSupplier(actor: Actor, input: Record<string, unknown>) {
  const f = readSupplier(input, false);
  return sql.begin(async (tx) => {
    const [{ id }] = await tx<{ id: number }[]>`INSERT INTO suppliers ${tx({ ...f, company_id: actor.companyId })} RETURNING id`;
    const [s] = await tx<SupplierOut[]>`SELECT ${SCOLS()} FROM suppliers WHERE id = ${id}`;
    await auditBy(tx, actor, 'create', 'supplier', id);
    await emit(tx, actor.companyId, 'supplier.created', s);
    return s;
  });
}

export async function updateSupplier(actor: Actor, id: number, input: Record<string, unknown>) {
  const f = readSupplier(input, true);
  return sql.begin(async (tx) => {
    // Nya bankuppgifter gäller först när en annan behörig person har godkänt dem (skydd mot bedrägerier)
    const [cur] = await tx<{ name: string; bankgiro: string; plusgiro: string; bank_account: string; iban: string; bic: string }[]>`SELECT name, bankgiro, plusgiro, bank_account, iban, bic FROM suppliers WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!cur) throw new NotFoundError('Leverantören');
    const changed = bankChanges(cur, f as never);
    let pending = false;
    if (Object.keys(changed).length) {
      for (const k of BANK_FIELDS) delete f[k];
      await requestBankChange(tx, actor, id, cur.name, { bankgiro: cur.bankgiro, plusgiro: cur.plusgiro, bank_account: cur.bank_account, iban: cur.iban, bic: cur.bic }, changed);
      pending = true;
    }
    const r = Object.keys(f).length
      ? await tx`UPDATE suppliers SET ${tx(f)} WHERE id = ${id} AND company_id = ${actor.companyId} RETURNING id`
      : await tx`SELECT id FROM suppliers WHERE id = ${id} AND company_id = ${actor.companyId}`;
    if (!r.length) throw new NotFoundError('Leverantören');
    const [s] = await tx<SupplierOut[]>`SELECT ${SCOLS()} FROM suppliers WHERE id = ${id}`;
    await auditBy(tx, actor, 'update', 'supplier', id, Object.keys(f));
    await emit(tx, actor.companyId, 'supplier.updated', s);
    return { ...s, pending_bank_change: pending };
  });
}

// ---------- Leverantörsfakturor ----------

export interface SupplierInvoiceOut {
  id: number; object: 'supplier_invoice'; supplier_id: number; supplier_name: string; invoice_number: string;
  invoice_date: string; due_date: string; payment_reference: string; description: string; total: number; vat: number;
  status: 'booked' | 'approved' | 'paid'; paid_amount: number; approved_by: string | null; approved_at: string | null; paid_date: string | null;
  voucher_id: number | null; payment_voucher_id: number | null; created_at: string;
}

async function fetchSI(db: Tx | typeof sql, companyId: number, id: number): Promise<SupplierInvoiceOut> {
  const [i] = await db<SupplierInvoiceOut[]>`
    SELECT i.id, 'supplier_invoice' AS object, i.supplier_id, s.name AS supplier_name, i.invoice_number,
      to_char(i.invoice_date,'YYYY-MM-DD') AS invoice_date, to_char(i.due_date,'YYYY-MM-DD') AS due_date, i.payment_reference,
      i.description, i.total, i.vat, i.status, i.paid_amount, u.name AS approved_by, i.approved_at, to_char(i.paid_date,'YYYY-MM-DD') AS paid_date,
      i.voucher_id, i.payment_voucher_id, i.created_at
    FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id LEFT JOIN users u ON u.id = i.approved_by
    WHERE i.id = ${id} AND i.company_id = ${companyId}`;
  if (!i) throw new NotFoundError('Leverantörsfakturan');
  return i;
}
export const getSupplierInvoice = (companyId: number, id: number) => fetchSI(sql, companyId, id);

export async function listSupplierInvoices(companyId: number, p: Page, f: { status?: string; supplier_id?: number }) {
  const rows = await sql<{ id: number }[]>`SELECT id FROM supplier_invoices WHERE company_id = ${companyId}
    ${f.status ? sql`AND status = ${f.status}` : sql``} ${f.supplier_id ? sql`AND supplier_id = ${f.supplier_id}` : sql``}
    ${p.startingAfter ? sql`AND id > ${p.startingAfter}` : sql``} ORDER BY id LIMIT ${p.limit + 1}`;
  const res = list([...rows], p);
  return { ...res, data: await Promise.all(res.data.map((r) => getSupplierInvoice(companyId, r.id))) };
}

/** Registrerar en leverantörsfaktura. Faktureringsmetoden: bokförs direkt. Kontantmetoden: konteringen sparas
 *  och bokförs när fakturan betalas (eller per bokslutsdagen). Belopp i öre. */
export async function registerSupplierInvoice(actor: Actor, input: Record<string, unknown>, attachment?: AttachmentIn | null) {
  const supplierId = int(input, 'supplier_id', 'Leverantör');
  const [sup] = await sql<{ name: string; default_account: number; cost_center_id: number | null }[]>`SELECT name, default_account, cost_center_id FROM suppliers WHERE id = ${supplierId} AND company_id = ${actor.companyId}`;
  if (!sup) throw new ValidationError('Leverantören finns inte');
  const total = ore(input, 'total', 'Totalbelopp', { min: 1 });
  const vat = optInt(input, 'vat', 'Moms') ?? 0;
  if (vat < 0) throw new ValidationError('Ogiltigt momsbelopp');
  // Kostnadsställe/projekt: per rad, annars för hela fakturan, annars leverantörens standard
  const cc = dimId(input.cost_center_id) ?? sup.cost_center_id;
  const pr = dimId(input.project_id);
  const costs: CostLine[] = input.lines == null
    ? [{ account: sup.default_account, amount: total - vat, costCenterId: cc, projectId: pr }]
    : arr(input, 'lines', 'Konteringsrader').map((r, i) => ({
        account: int(r, 'account', `Rad ${i + 1}: konto`), amount: int(r, 'amount', `Rad ${i + 1}: belopp`), description: str(r, 'description'),
        costCenterId: dimId(r.cost_center_id) ?? cc, projectId: dimId(r.project_id) ?? pr,
      }));
  if (costs.length === 0) throw new ValidationError('Ange minst en konteringsrad');
  const invoiceNumber = str(input, 'invoice_number', { required: true, label: 'Leverantörens fakturanummer' });
  const currency = (str(input, 'currency') || 'SEK').toUpperCase();
  if (!(CURRENCIES as readonly string[]).includes(currency)) throw new ValidationError(`Valuta stöds inte: ${currency}`);
  const totalCurrency = isForeign(currency) ? ore(input, 'total_currency', `Belopp i ${currency}`, { min: 1 }) : null;
  const d = date(input, 'invoice_date', 'Fakturadatum');
  const lines = supplierInvoiceLines(costs, vat, total);
  try {
    return await sql.begin(async (tx) => {
      const [{ id }] = await tx<{ id: number }[]>`INSERT INTO supplier_invoices ${tx({
        company_id: actor.companyId, supplier_id: supplierId, invoice_number: invoiceNumber, invoice_date: d,
        due_date: date(input, 'due_date', 'Förfallodatum', false) || d, payment_reference: str(input, 'payment_reference'),
        description: str(input, 'description'), total, vat, status: 'booked', cost_lines: tx.json(costs as never), currency, total_currency: totalCurrency, registered_by: actor.userId,
      })} RETURNING id`;
      const [{ m }] = await tx<{ m: string }[]>`SELECT accounting_method AS m FROM companies WHERE id = ${actor.companyId}`;
      const v = m === 'cash' ? null : await createVoucher(tx, {
        actor, date: d, description: `Leverantörsfaktura ${invoiceNumber}, ${sup.name}`, lines, sourceType: 'supplier_invoice', sourceId: id, series: 'C',
      });
      if (v) await tx`UPDATE supplier_invoices SET voucher_id = ${v.id} WHERE id = ${id}`;
      if (attachment) await insertAttachment(tx, actor, v?.id ?? null, attachment, id);
      // Kom ihåg konteringen för leverantören (huvudkontot, moms och dimensioner)
      if (!isForeign(currency)) await rememberCoding(tx, actor.companyId, 'supplier', String(supplierId), {
        account: costs[0].account, vatRate: vatRateOf(total, vat), costCenterId: costs[0].costCenterId ?? null, projectId: costs[0].projectId ?? null,
      });
      await auditBy(tx, actor, 'register', 'supplier_invoice', id);
      if (!(await checkDuplicate(tx, actor.companyId, id))) await checkPriceIncrease(tx, actor.companyId, id);
      const out = await fetchSI(tx, actor.companyId, id);
      await emit(tx, actor.companyId, 'supplier_invoice.registered', out);
      notify.attest(actor.companyId, actor.userId ?? null, sup.name, total, id);
      return out;
    });
  } catch (e) {
    if (String((e as Error)?.message).includes('supplier_invoices_company_id_supplier_id_invoice_number_key')) {
      throw new ConflictError('Fakturan är redan registrerad för denna leverantör');
    }
    throw e;
  }
}

export async function approveSupplierInvoice(actor: Actor, id: number) {
  return sql.begin(async (tx) => {
    const [inv] = await tx<{ status: string; total: number; registered_by: number | null }[]>`
      SELECT status, total, registered_by FROM supplier_invoices WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!inv) throw new NotFoundError('Leverantörsfakturan');
    if (inv.status !== 'booked') throw new ConflictError('Fakturan är redan attesterad eller betald');
    const blocked = (await blockedInvoices(tx, actor.companyId, [id], { forPayment: false })).get(id);
    if (blocked) throw new ConflictError(`Fakturan kan inte attesteras: ${blocked}`);
    const [co] = await tx<{ threshold: number | null; not_registrant: boolean }[]>`SELECT attest_threshold AS threshold, attest_not_registrant AS not_registrant FROM companies WHERE id = ${actor.companyId}`;
    const rules = { threshold: co.threshold == null ? null : Number(co.threshold), notRegistrant: co.not_registrant };
    const approvedBy = (await tx<{ user_id: number }[]>`SELECT user_id FROM supplier_invoice_approvals WHERE supplier_invoice_id = ${id}`).map((r) => r.user_id);
    const err = attestError({ userId: actor.userId, registeredBy: inv.registered_by, approvedBy, rules });
    if (err) throw new ConflictError(err);
    await tx`INSERT INTO supplier_invoice_approvals (supplier_invoice_id, user_id) VALUES (${id}, ${actor.userId})`;
    const needed = requiredApprovals(Number(inv.total), rules);
    const done = approvedBy.length + 1 >= needed;
    if (done) await tx`UPDATE supplier_invoices SET status = 'approved', approved_by = ${actor.userId}, approved_at = now() WHERE id = ${id}`;
    await auditBy(tx, actor, done ? 'approve' : 'approve_partial', 'supplier_invoice', id, { step: approvedBy.length + 1, of: needed });
    const out = await fetchSI(tx, actor.companyId, id);
    if (done) await emit(tx, actor.companyId, 'supplier_invoice.approved', out);
    return out;
  });
}

/** Bokför betalning av en eller flera attesterade fakturor (i en transaktion) */
export async function paySupplierInvoices(actor: Actor, ids: number[], input: Record<string, unknown>) {
  if (ids.length === 0) throw new ValidationError('Välj minst en faktura');
  return sql.begin(async (tx) => {
    const out: SupplierInvoiceOut[] = [];
    for (const id of ids) out.push(await paySupplierInvoiceTx(tx, actor, id, input));
    return out;
  });
}

/** Betalning av en leverantörsfaktura i en befintlig transaktion. autoApprove används av bankavstämningen
 *  när betalningen redan har gjorts i banken (attesten loggas då på den som stämmer av). */
export async function paySupplierInvoiceTx(tx: Tx, actor: Actor, id: number, input: Record<string, unknown>, opts: { autoApprove?: boolean } = {}) {
  const d = date(input, 'date', 'Betaldatum');
  const bank = optInt(input, 'bank_account', 'Bankkonto') ?? 1930;
  if (bank < 1900 || bank > 1999) throw new ValidationError('Bankkonto måste vara ett 19xx-konto');
  const [inv] = await tx<{ status: string; total: number; paid_amount: number; vat: number; invoice_number: string; supplier: string; voucher_id: number | null; imported: boolean; currency: string; cost_lines: CostLine[] | null }[]>`
    SELECT i.status, i.total, i.paid_amount, i.vat, i.invoice_number, s.name AS supplier, i.voucher_id, i.imported, i.currency, i.cost_lines FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id
    WHERE i.id = ${id} AND i.company_id = ${actor.companyId} FOR UPDATE OF i`;
  if (!inv) throw new NotFoundError('Leverantörsfakturan');
  if (inv.status === 'booked' && opts.autoApprove) {
    await tx`UPDATE supplier_invoices SET status = 'approved', approved_by = ${actor.userId}, approved_at = now() WHERE id = ${id}`;
    await auditBy(tx, actor, 'approve', 'supplier_invoice', id, { via: 'bank_reconciliation' });
    inv.status = 'approved';
  }
  if (inv.status !== 'approved') throw new ConflictError(`Faktura ${inv.invoice_number} (${inv.supplier}) är inte attesterad`);
  const total = Number(inv.total), paidBefore = Number(inv.paid_amount);
  const remaining = total - paidBefore;
  const amount = optInt(input, 'amount', 'Belopp') ?? remaining;
  if (isForeign(inv.currency) && inv.voucher_id) {
    // Utländsk valuta: betalt belopp i kronor reglerar hela skulden, skillnaden är kursvinst/-förlust
    if (amount <= 0 || amount < remaining * 0.8 || amount > remaining * 1.2) throw new ValidationError(`Betalt belopp avviker mer än 20 % från skulden (${(remaining / 100).toFixed(2).replace('.', ',')} kr)`);
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, 3960, 'Valutakursvinster på fordringar och skulder av rörelsekaraktär'), (${actor.companyId}, 7960, 'Valutakursförluster på fordringar och skulder av rörelsekaraktär') ON CONFLICT DO NOTHING`;
    const v = await createVoucher(tx, {
      actor, date: d, description: `Betalning leverantörsfaktura ${inv.invoice_number} (${inv.currency}), ${inv.supplier}`,
      lines: fxPaymentLines(remaining, amount, bank, ACC.supplierDebts, -1), sourceType: 'supplier_payment', sourceId: id, series: 'C',
    });
    await tx`INSERT INTO supplier_invoice_payments (company_id, supplier_invoice_id, date, amount, voucher_id) VALUES (${actor.companyId}, ${id}, ${d}, ${remaining}, ${v.id})`;
    await tx`UPDATE supplier_invoices SET paid_amount = total, status = 'paid', payment_voucher_id = ${v.id}, paid_date = ${d} WHERE id = ${id}`;
    await auditBy(tx, actor, 'pay', 'supplier_invoice', id, { paid: amount, fx: remaining - amount });
    const out = await fetchSI(tx, actor.companyId, id);
    await emit(tx, actor.companyId, 'supplier_invoice.paid', out);
    return out;
  }
  if (amount <= 0 || amount > remaining) throw new ValidationError(`Beloppet måste vara mellan 0 och det som återstår (${(remaining / 100).toFixed(2).replace('.', ',')} kr)`);
  const full = paidBefore + amount === total;
  // Kontantmetoden: fakturan är inte bokförd än – kostnad och moms bokförs vid betalningen (vid delbetalning med betalningens andel)
  const cash = !inv.voucher_id && !inv.imported;
  if (cash && !inv.cost_lines) throw new ConflictError(`Faktura ${inv.invoice_number} saknar kontering`);
  const v = await createVoucher(tx, {
    actor, date: d, description: `${full && !paidBefore ? 'Betalning' : full ? 'Slutbetalning' : 'Delbetalning'} leverantörsfaktura ${inv.invoice_number}, ${inv.supplier}${cash ? ' (kontantmetoden)' : ''}`,
    lines: cash ? proportionalLines(supplierInvoiceLines(inv.cost_lines!, inv.vat, total), total, paidBefore, amount, ACC.supplierDebts, bank) : supplierPaymentLines(amount, bank),
    sourceType: 'supplier_payment', sourceId: id, series: 'C',
  });
  await tx`INSERT INTO supplier_invoice_payments (company_id, supplier_invoice_id, date, amount, voucher_id) VALUES (${actor.companyId}, ${id}, ${d}, ${amount}, ${v.id})`;
  await tx`UPDATE supplier_invoices SET paid_amount = paid_amount + ${amount}, payment_voucher_id = ${v.id}, status = ${full ? 'paid' : 'approved'}, paid_date = ${full ? d : null} WHERE id = ${id}`;
  if (cash) await tx`UPDATE attachments SET voucher_id = ${v.id} WHERE supplier_invoice_id = ${id} AND voucher_id IS NULL`;
  await auditBy(tx, actor, full ? 'pay' : 'partly_pay', 'supplier_invoice', id, { amount });
  const o = await fetchSI(tx, actor.companyId, id);
  await emit(tx, actor.companyId, full ? 'supplier_invoice.paid' : 'supplier_invoice.partly_paid', o);
  return o;
}

/** Kontantmetoden: bokför obetalda leverantörsfakturor per bokslutsdagen (kostnad och moms mot leverantörsskuld) */
export async function bookOpenSupplierInvoicesAtYearEnd(tx: Tx, actor: Actor, endDate: string): Promise<number> {
  const open = await tx<{ id: number; invoice_number: string; supplier: string; total: number; paid_amount: number; vat: number; cost_lines: CostLine[] | null }[]>`
    SELECT i.id, i.invoice_number, s.name AS supplier, i.total, i.paid_amount, i.vat, i.cost_lines FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id
    WHERE i.company_id = ${actor.companyId} AND i.status IN ('booked', 'approved') AND i.voucher_id IS NULL AND NOT i.imported AND i.invoice_date <= ${endDate}
    ORDER BY i.invoice_date, i.id FOR UPDATE OF i`;
  for (const inv of open) {
    if (!inv.cost_lines) throw new ConflictError(`Faktura ${inv.invoice_number} saknar kontering`);
    const v = await createVoucher(tx, {
      actor, date: endDate, description: `Obetald leverantörsfaktura ${inv.invoice_number}, ${inv.supplier} – per bokslutsdagen`,
      // Delbetald: bara den obetalda andelen bokförs (det betalda är redan bokfört vid betalningen)
      lines: Number(inv.paid_amount) > 0
        ? proportionalLines(supplierInvoiceLines(inv.cost_lines, inv.vat, inv.total), Number(inv.total), Number(inv.paid_amount), Number(inv.total) - Number(inv.paid_amount), ACC.supplierDebts, ACC.supplierDebts)
        : supplierInvoiceLines(inv.cost_lines, inv.vat, inv.total),
      sourceType: 'supplier_invoice', sourceId: inv.id, series: 'C',
    });
    await tx`UPDATE supplier_invoices SET voucher_id = ${v.id} WHERE id = ${inv.id}`;
    await tx`UPDATE attachments SET voucher_id = ${v.id} WHERE supplier_invoice_id = ${inv.id} AND voucher_id IS NULL`;
    await auditBy(tx, actor, 'book_yearend', 'supplier_invoice', inv.id);
  }
  return open.length;
}

/**
 * Bankens avisering (camt.054) om genomförda betalningar: leverantörsfakturor som betalats med vår betalfil
 * (EndToEndId LF<id>) bokförs som betalda på bankens bokföringsdag. Avvisade betalningar rapporteras.
 */
export async function applyPaymentNotification(actor: Actor, xml: string, bankAccount = 1930) {
  const { parseCamt054 } = await import('@/lib/bank/parse');
  const list = parseCamt054(xml);
  if (!list.length) throw new ValidationError('Filen innehåller inga betalningar');
  const result = { paid: [] as string[], rejected: [] as string[], skipped: [] as string[] };
  for (const p of list) {
    const m = p.endToEndId.match(/^LF(\d+)$/);
    if (!m) { result.skipped.push(`${p.endToEndId} (okänd referens)`); continue; }
    const [inv] = await sql<{ id: number; status: string; label: string; remaining: number }[]>`
      SELECT i.id, i.status, s.name || ' ' || i.invoice_number AS label, (i.total - i.paid_amount)::bigint AS remaining
      FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id WHERE i.id = ${Number(m[1])} AND i.company_id = ${actor.companyId}`;
    if (!inv) { result.skipped.push(`${p.endToEndId} (finns inte i bolaget)`); continue; }
    if (p.status === 'rejected') { result.rejected.push(inv.label); continue; }
    if (inv.status === 'paid') { result.skipped.push(`${inv.label} (redan betald)`); continue; }
    try {
      await sql.begin((tx) => paySupplierInvoiceTx(tx, actor, inv.id, { date: p.date, bank_account: bankAccount, amount: Math.min(p.amount, Number(inv.remaining)) }));
      result.paid.push(inv.label);
    } catch (e) {
      result.skipped.push(`${inv.label} (${e instanceof Error ? e.message : 'fel'})`);
    }
  }
  return result;
}
