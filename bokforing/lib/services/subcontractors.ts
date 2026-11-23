import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { assignmentResult, invoicedHours, markupPct } from '@/lib/subcontractors';
import type { Actor } from './actor';
import { int, str } from './input';
import { saveDraftTx } from './invoices';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function overview(companyId: number) {
  const list = await sql<{ id: number; consultant: string; name: string; supplier_id: number; supplier: string; customer: string; cost_rate: number; bill_rate: number; active: boolean }[]>`
    SELECT a.id, a.consultant, a.name, a.supplier_id, s.name AS supplier, c.name AS customer, a.cost_rate::float8 AS cost_rate, a.bill_rate::float8 AS bill_rate, a.active
    FROM sub_assignments a JOIN suppliers s ON s.id = a.supplier_id JOIN customers c ON c.id = a.customer_id WHERE a.company_id = ${companyId} ORDER BY a.active DESC, c.name, a.consultant`;
  const periods = list.length ? await sql<{ id: number; assignment_id: number; period: string; hours: number; invoice_id: number | null; supplier_invoice_id: number | null; supplier_hours: number | null; supplier_invoice: string | null }[]>`
    SELECT p.id, p.assignment_id, p.period, p.hours::float8 AS hours, p.invoice_id, p.supplier_invoice_id, p.supplier_hours::float8 AS supplier_hours, si.invoice_number AS supplier_invoice
    FROM sub_periods p LEFT JOIN supplier_invoices si ON si.id = p.supplier_invoice_id WHERE p.assignment_id IN ${sql(list.map((a) => a.id))} ORDER BY p.period DESC` : [];
  const supplierInvoices = await sql<{ id: number; supplier_id: number; number: string; net: number }[]>`SELECT si.id, si.supplier_id, si.invoice_number AS number, (si.total - si.vat)::float8 AS net FROM supplier_invoices si
    WHERE si.company_id = ${companyId} AND si.voucher_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sub_periods p WHERE p.supplier_invoice_id = si.id) ORDER BY si.invoice_date DESC LIMIT 200`;
  const suppliers = await sql<{ id: number; name: string }[]>`SELECT id, name FROM suppliers WHERE company_id = ${companyId} ORDER BY name LIMIT 500`;
  const customers = await sql<{ id: number; name: string }[]>`SELECT id, name FROM customers WHERE company_id = ${companyId} ORDER BY name LIMIT 500`;
  return {
    suppliers, customers,
    assignments: list.map((a) => {
      const own = periods.filter((p) => p.assignment_id === a.id);
      return { ...a, markup: markupPct(a.cost_rate, a.bill_rate), periods: own, result: assignmentResult(own.map((p) => ({ hours: p.hours, billed: !!p.invoice_id, supplier_hours: p.supplier_hours })), a.cost_rate, a.bill_rate),
        supplierInvoices: supplierInvoices.filter((s) => s.supplier_id === a.supplier_id) };
    }),
  };
}

export async function addAssignment(actor: Actor, input: Record<string, unknown>) {
  const supplierId = int(input, 'supplier_id', 'Underkonsult (leverantör)'), customerId = int(input, 'customer_id', 'Kund');
  const [s] = await sql`SELECT 1 FROM suppliers WHERE id = ${supplierId} AND company_id = ${actor.companyId}`;
  if (!s) throw new NotFoundError('Leverantören');
  const [c] = await sql`SELECT 1 FROM customers WHERE id = ${customerId} AND company_id = ${actor.companyId}`;
  if (!c) throw new NotFoundError('Kunden');
  const cost = parseAmount(String(input.cost_rate ?? '').trim());
  if (cost == null || cost <= 0) throw new ValidationError('Ange underkonsultens timpris');
  const markup = String(input.markup_pct ?? '').trim();
  const billRaw = String(input.bill_rate ?? '').trim();
  const bill = billRaw ? parseAmount(billRaw) : markup ? Math.round(cost * (1 + Number(markup.replace(',', '.')) / 100)) : null;
  if (bill == null || !Number.isFinite(bill) || bill <= 0) throw new ValidationError('Ange kundens timpris eller ett påslag i procent');
  await sql`INSERT INTO sub_assignments ${sql({ company_id: actor.companyId, supplier_id: supplierId, customer_id: customerId, consultant: str(input, 'consultant', { required: true, label: 'Konsult', max: 200 }),
    name: str(input, 'name', { required: true, label: 'Uppdrag', max: 200 }), cost_rate: cost, bill_rate: bill, created_by: actor.userId })}`;
}

const ownAssignment = async (actor: Actor, id: number) => {
  const [a] = await sql<{ customer_id: number; consultant: string; name: string; cost_rate: number; bill_rate: number; supplier_id: number }[]>`SELECT customer_id, consultant, name, cost_rate::float8 AS cost_rate, bill_rate::float8 AS bill_rate, supplier_id
    FROM sub_assignments WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!a) throw new NotFoundError('Uppdraget');
  return a;
};

/** Underkonsultens rapporterade tid för en månad */
export async function report(actor: Actor, assignmentId: number, input: Record<string, unknown>) {
  await ownAssignment(actor, assignmentId);
  const period = str(input, 'period', { required: true, label: 'Månad' });
  if (!PERIOD.test(period)) throw new ValidationError('Ange månaden som ÅÅÅÅ-MM');
  const hours = Number(String(input.hours ?? '').replace(',', '.'));
  if (!Number.isFinite(hours) || hours <= 0) throw new ValidationError('Ange antal timmar');
  try { await sql`INSERT INTO sub_periods (assignment_id, period, hours) VALUES (${assignmentId}, ${period}, ${hours})`; }
  catch (e) { if (String((e as Error).message).includes('sub_periods_assignment_id_period_key')) throw new ConflictError('Månaden är redan rapporterad'); throw e; }
}

/** Vidarefakturering av månadens tid till kunden med kundens timpris */
export async function invoice(actor: Actor, periodId: number) {
  return sql.begin(async (tx) => {
    const [p] = await tx<{ assignment_id: number; period: string; hours: number; invoice_id: number | null }[]>`SELECT p.assignment_id, p.period, p.hours::float8 AS hours, p.invoice_id FROM sub_periods p
      JOIN sub_assignments a ON a.id = p.assignment_id WHERE p.id = ${periodId} AND a.company_id = ${actor.companyId} FOR UPDATE OF p`;
    if (!p) throw new NotFoundError('Perioden');
    if (p.invoice_id) throw new ConflictError('Perioden är redan fakturerad');
    const a = await ownAssignment(actor, p.assignment_id);
    const inv = await saveDraftTx(tx, actor, null, { customer_id: a.customer_id, invoice_date: today(), notes: `${a.name}: konsulttjänster ${p.period}.`,
      lines: [{ description: `${a.name} – ${a.consultant}, ${p.period}`, quantity: p.hours, unit: 'tim', unit_price: a.bill_rate, vat_rate: 25 }] });
    await tx`UPDATE sub_periods SET invoice_id = ${inv.id} WHERE id = ${periodId}`;
    await auditBy(tx, actor, 'sub_invoiced', 'sub_assignment', p.assignment_id, { period: p.period, hours: p.hours });
    return inv.id;
  });
}

/** Underkonsultens faktura stäms av mot den rapporterade tiden */
export async function matchSupplierInvoice(actor: Actor, periodId: number, input: Record<string, unknown>) {
  const siId = int(input, 'supplier_invoice_id', 'Leverantörsfaktura');
  return sql.begin(async (tx) => {
    const [p] = await tx<{ assignment_id: number; hours: number; supplier_invoice_id: number | null }[]>`SELECT p.assignment_id, p.hours::float8 AS hours, p.supplier_invoice_id FROM sub_periods p
      JOIN sub_assignments a ON a.id = p.assignment_id WHERE p.id = ${periodId} AND a.company_id = ${actor.companyId} FOR UPDATE OF p`;
    if (!p) throw new NotFoundError('Perioden');
    if (p.supplier_invoice_id) throw new ConflictError('Perioden är redan avstämd');
    const a = await ownAssignment(actor, p.assignment_id);
    const [si] = await tx<{ supplier_id: number; net: number }[]>`SELECT supplier_id, (total - vat)::float8 AS net FROM supplier_invoices WHERE id = ${siId} AND company_id = ${actor.companyId}`;
    if (!si) throw new NotFoundError('Leverantörsfakturan');
    if (si.supplier_id !== a.supplier_id) throw new ValidationError('Fakturan är från en annan leverantör');
    const [used] = await tx`SELECT 1 FROM sub_periods WHERE supplier_invoice_id = ${siId}`;
    if (used) throw new ConflictError('Fakturan är redan avstämd mot en annan period');
    const h = invoicedHours(si.net, a.cost_rate);
    await tx`UPDATE sub_periods SET supplier_invoice_id = ${siId}, supplier_hours = ${h} WHERE id = ${periodId}`;
    return { invoiced: h, reported: p.hours, diff: Math.round((h - p.hours) * 100) / 100 };
  });
}
