import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { createVoucher } from '@/lib/server/ledger';
import { auditBy } from '@/lib/server/audit';
import { emit } from '@/lib/server/events';
import { supplierInvoiceLines, supplierPaymentLines, type CostLine } from '@/lib/supplier';
import type { Actor } from './actor';
import { arr, date, has, int, list, optInt, ore, str, type Page } from './input';
import { insertAttachment, type AttachmentIn } from './vouchers';

// ---------- Leverantörer ----------

export interface SupplierOut {
  id: number; object: 'supplier'; name: string; orgnr: string; bankgiro: string; plusgiro: string; bank_account: string;
  default_account: number; email: string; created_at: string;
}
const SCOLS = () => sql`id, 'supplier' AS object, name, orgnr, bankgiro, plusgiro, bank_account, default_account, email, created_at`;

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
    const r = Object.keys(f).length
      ? await tx`UPDATE suppliers SET ${tx(f)} WHERE id = ${id} AND company_id = ${actor.companyId} RETURNING id`
      : await tx`SELECT id FROM suppliers WHERE id = ${id} AND company_id = ${actor.companyId}`;
    if (!r.length) throw new NotFoundError('Leverantören');
    const [s] = await tx<SupplierOut[]>`SELECT ${SCOLS()} FROM suppliers WHERE id = ${id}`;
    await auditBy(tx, actor, 'update', 'supplier', id, Object.keys(f));
    await emit(tx, actor.companyId, 'supplier.updated', s);
    return s;
  });
}

// ---------- Leverantörsfakturor ----------

export interface SupplierInvoiceOut {
  id: number; object: 'supplier_invoice'; supplier_id: number; supplier_name: string; invoice_number: string;
  invoice_date: string; due_date: string; payment_reference: string; description: string; total: number; vat: number;
  status: 'booked' | 'approved' | 'paid'; approved_by: string | null; approved_at: string | null; paid_date: string | null;
  voucher_id: number | null; payment_voucher_id: number | null; created_at: string;
}

async function fetchSI(db: Tx | typeof sql, companyId: number, id: number): Promise<SupplierInvoiceOut> {
  const [i] = await db<SupplierInvoiceOut[]>`
    SELECT i.id, 'supplier_invoice' AS object, i.supplier_id, s.name AS supplier_name, i.invoice_number,
      to_char(i.invoice_date,'YYYY-MM-DD') AS invoice_date, to_char(i.due_date,'YYYY-MM-DD') AS due_date, i.payment_reference,
      i.description, i.total, i.vat, i.status, u.name AS approved_by, i.approved_at, to_char(i.paid_date,'YYYY-MM-DD') AS paid_date,
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

/** Registrerar och bokför en leverantörsfaktura (faktureringsmetoden). Belopp i öre. */
export async function registerSupplierInvoice(actor: Actor, input: Record<string, unknown>, attachment?: AttachmentIn | null) {
  const supplierId = int(input, 'supplier_id', 'Leverantör');
  const [sup] = await sql<{ name: string; default_account: number }[]>`SELECT name, default_account FROM suppliers WHERE id = ${supplierId} AND company_id = ${actor.companyId}`;
  if (!sup) throw new ValidationError('Leverantören finns inte');
  const total = ore(input, 'total', 'Totalbelopp', { min: 1 });
  const vat = optInt(input, 'vat', 'Moms') ?? 0;
  if (vat < 0) throw new ValidationError('Ogiltigt momsbelopp');
  const costs: CostLine[] = input.lines == null
    ? [{ account: sup.default_account, amount: total - vat }]
    : arr(input, 'lines', 'Konteringsrader').map((r, i) => ({
        account: int(r, 'account', `Rad ${i + 1}: konto`), amount: int(r, 'amount', `Rad ${i + 1}: belopp`), description: str(r, 'description'),
      }));
  if (costs.length === 0) throw new ValidationError('Ange minst en konteringsrad');
  const invoiceNumber = str(input, 'invoice_number', { required: true, label: 'Leverantörens fakturanummer' });
  const d = date(input, 'invoice_date', 'Fakturadatum');
  const lines = supplierInvoiceLines(costs, vat, total);
  try {
    return await sql.begin(async (tx) => {
      const [{ id }] = await tx<{ id: number }[]>`INSERT INTO supplier_invoices ${tx({
        company_id: actor.companyId, supplier_id: supplierId, invoice_number: invoiceNumber, invoice_date: d,
        due_date: date(input, 'due_date', 'Förfallodatum', false) || d, payment_reference: str(input, 'payment_reference'),
        description: str(input, 'description'), total, vat, status: 'booked',
      })} RETURNING id`;
      const v = await createVoucher(tx, {
        actor, date: d, description: `Leverantörsfaktura ${invoiceNumber}, ${sup.name}`, lines, sourceType: 'supplier_invoice', sourceId: id, series: 'C',
      });
      await tx`UPDATE supplier_invoices SET voucher_id = ${v.id} WHERE id = ${id}`;
      if (attachment) await insertAttachment(tx, actor, v.id, attachment, id);
      await auditBy(tx, actor, 'register', 'supplier_invoice', id);
      const out = await fetchSI(tx, actor.companyId, id);
      await emit(tx, actor.companyId, 'supplier_invoice.registered', out);
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
    const r = await tx`UPDATE supplier_invoices SET status = 'approved', approved_by = ${actor.userId}, approved_at = now()
      WHERE id = ${id} AND company_id = ${actor.companyId} AND status = 'booked' RETURNING id`;
    if (!r.length) { await fetchSI(tx, actor.companyId, id); throw new ConflictError('Fakturan är redan attesterad eller betald'); }
    await auditBy(tx, actor, 'approve', 'supplier_invoice', id);
    const out = await fetchSI(tx, actor.companyId, id);
    await emit(tx, actor.companyId, 'supplier_invoice.approved', out);
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
  const [inv] = await tx<{ status: string; total: number; invoice_number: string; supplier: string }[]>`
    SELECT i.status, i.total, i.invoice_number, s.name AS supplier FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id
    WHERE i.id = ${id} AND i.company_id = ${actor.companyId} FOR UPDATE OF i`;
  if (!inv) throw new NotFoundError('Leverantörsfakturan');
  if (inv.status === 'booked' && opts.autoApprove) {
    await tx`UPDATE supplier_invoices SET status = 'approved', approved_by = ${actor.userId}, approved_at = now() WHERE id = ${id}`;
    await auditBy(tx, actor, 'approve', 'supplier_invoice', id, { via: 'bank_reconciliation' });
    inv.status = 'approved';
  }
  if (inv.status !== 'approved') throw new ConflictError(`Faktura ${inv.invoice_number} (${inv.supplier}) är inte attesterad`);
  const v = await createVoucher(tx, {
    actor, date: d, description: `Betalning leverantörsfaktura ${inv.invoice_number}, ${inv.supplier}`,
    lines: supplierPaymentLines(inv.total, bank), sourceType: 'supplier_payment', sourceId: id, series: 'C',
  });
  await tx`UPDATE supplier_invoices SET status = 'paid', paid_date = ${d}, payment_voucher_id = ${v.id} WHERE id = ${id}`;
  await auditBy(tx, actor, 'pay', 'supplier_invoice', id);
  const o = await fetchSI(tx, actor.companyId, id);
  await emit(tx, actor.companyId, 'supplier_invoice.paid', o);
  return o;
}
