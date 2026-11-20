import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { ataEffect, rcCheck, RETAINED_PAYABLE, RETAINED_RECEIVABLE, retentionAmount, retentionLines, type AtaKind, type ChangeOrder } from '@/lib/construction';
import type { Actor } from './actor';
import { date, int, optInt, str } from './input';

const KINDS: AtaKind[] = ['tillagg', 'andring', 'avgaende'];
function kronor(v: unknown, label: string, required = true) {
  const raw = String(v ?? '').trim();
  if (!raw && !required) return 0;
  const n = parseAmount(raw);
  if (n == null || n < 0 || (required && n === 0)) throw new ValidationError(`Ange ${label} i kronor`);
  return n;
}

// ---------- ÄTA ----------
export async function changeOrders(companyId: number, contractId?: number) {
  return sql<(ChangeOrder & { id: number; contract_id: number; no: number; description: string })[]>`
    SELECT id, contract_id, no, kind, description, amount::float8 AS amount, cost::float8 AS cost, status, to_char(decided_on,'YYYY-MM-DD') AS decided_on
    FROM poc_change_orders WHERE company_id = ${companyId} ${contractId ? sql`AND contract_id = ${contractId}` : sql``} ORDER BY contract_id, no`;
}

/** ÄTA i registret per fastprisuppdrag – får ett löpnummer och väntar på beställarens beslut */
export async function addChangeOrder(actor: Actor, contractId: number, input: Record<string, unknown>) {
  const kind = str(input, 'kind') as AtaKind;
  if (!KINDS.includes(kind)) throw new ValidationError('Välj typ av ÄTA');
  const description = str(input, 'description', { required: true, label: 'Beskrivning', max: 500 });
  const amount = kronor(input.amount, 'beloppet');
  const cost = kronor(input.cost, 'beräknad kostnad', false);
  return sql.begin(async (tx) => {
    const [c] = await tx<{ status: string }[]>`SELECT status FROM poc_contracts WHERE id = ${contractId} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!c) throw new NotFoundError('Uppdraget');
    if (c.status === 'done') throw new ConflictError('Uppdraget är avslutat');
    const [{ n }] = await tx<{ n: number }[]>`SELECT COALESCE(MAX(no), 0) + 1 AS n FROM poc_change_orders WHERE contract_id = ${contractId}`;
    const [r] = await tx<{ id: number; no: number }[]>`INSERT INTO poc_change_orders ${tx({ company_id: actor.companyId, contract_id: contractId, no: n, kind, description, amount, cost })} RETURNING id, no`;
    await auditBy(tx, actor, 'create', 'change_order', r.id, { kind, amount });
    return r;
  });
}

/** Beställarens beslut: godkänd ÄTA ändrar kontraktssumman och den beräknade kostnaden från beslutsdagen */
export async function decideChangeOrder(actor: Actor, id: number, input: Record<string, unknown>) {
  const approve = str(input, 'decision') === 'approve';
  const d = date(input, 'decided_on', 'Beslutsdag', false) || today();
  const r = await sql<{ id: number }[]>`UPDATE poc_change_orders o SET status = ${approve ? 'approved' : 'rejected'}, decided_on = ${d}
    FROM poc_contracts c WHERE o.id = ${id} AND o.company_id = ${actor.companyId} AND o.status = 'proposed' AND c.id = o.contract_id AND c.status = 'open' RETURNING o.id`;
  if (!r.length) throw new ConflictError('ÄTA:n är redan beslutad eller uppdraget avslutat');
  await auditBy(sql, actor, approve ? 'approve' : 'reject', 'change_order', id);
}

/** Kontraktsvärde och beräknad kostnad inklusive godkända ÄTA per datumet (används av successiv vinstavräkning) */
export async function adjustedContracts(companyId: number, at: string) {
  const os = await changeOrders(companyId);
  const by = new Map<number, ChangeOrder[]>();
  for (const o of os) by.set(o.contract_id, [...(by.get(o.contract_id) ?? []), o]);
  return (id: number) => ataEffect(by.get(id) ?? [], at);
}

// ---------- Innehållna belopp ----------
/** Kunden håller inne en del av fakturan (t.ex. till slutbesiktningen): 1682 mot 1510 och fakturan räknas som reglerad för den delen */
export async function retainCustomer(actor: Actor, input: Record<string, unknown>) {
  const invoiceId = int(input, 'invoice_id', 'Faktura');
  const pct = Number(String(input.pct ?? '').replace(',', '.'));
  const d = date(input, 'date', 'Datum', false) || today();
  return sql.begin(async (tx) => {
    const [i] = await tx<{ status: string; total: number; paid: number; voucher_id: number | null; currency: string; invoice_number: number; invoice_date: string }[]>`
      SELECT status, total::float8 AS total, paid_amount::float8 AS paid, voucher_id, currency, invoice_number, to_char(invoice_date,'YYYY-MM-DD') AS invoice_date
      FROM invoices WHERE id = ${invoiceId} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!i) throw new NotFoundError('Fakturan');
    if (i.status !== 'booked' || !i.voucher_id) throw new ConflictError('Bara bokförda, obetalda fakturor (faktureringsmetoden) kan få innehållna belopp');
    if (i.currency !== 'SEK') throw new ValidationError('Innehållna belopp stöds bara i kronor');
    if (d < i.invoice_date) throw new ValidationError('Datumet kan inte vara före fakturadatumet');
    let amount: number;
    try { amount = retentionAmount(i.total, pct, i.total - i.paid); } catch (e) { throw new ValidationError((e as Error).message); }
    if (amount <= 0) throw new ValidationError('Det finns inget obetalt att hålla inne');
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${RETAINED_RECEIVABLE}, 'Innehållna belopp hos kunder') ON CONFLICT DO NOTHING`;
    const v = await createVoucher(tx, { actor, date: d, description: `Innehållet belopp ${pct} % kundfaktura ${i.invoice_number}`, lines: fromSigned(retentionLines('customer', 'retain', amount)), sourceType: 'retention', sourceId: invoiceId });
    const [r] = await tx<{ id: number }[]>`INSERT INTO retentions ${tx({ company_id: actor.companyId, side: 'customer', invoice_id: invoiceId, amount, pct, date: d,
      release_after: date(input, 'release_after', 'Släpps', false) || null, note: str(input, 'note', { max: 300 }), voucher_id: v.id })} RETURNING id`;
    const full = i.paid + amount >= i.total;
    await tx`UPDATE invoices SET paid_amount = paid_amount + ${amount}, status = ${full ? 'paid' : 'booked'}, paid_date = ${full ? d : null} WHERE id = ${invoiceId}`;
    await auditBy(tx, actor, 'retain', 'invoice', invoiceId, { amount, pct });
    return { id: r.id, amount };
  });
}

/** Vi håller inne en del av en leverantörs/underentreprenörs faktura: 2440 mot 2446 */
export async function retainSupplier(actor: Actor, input: Record<string, unknown>) {
  const id = int(input, 'supplier_invoice_id', 'Leverantörsfaktura');
  const pct = Number(String(input.pct ?? '').replace(',', '.'));
  const d = date(input, 'date', 'Datum', false) || today();
  return sql.begin(async (tx) => {
    const [i] = await tx<{ status: string; total: number; paid: number; voucher_id: number | null; invoice_number: string; invoice_date: string; supplier: string }[]>`
      SELECT s.status, s.total::float8 AS total, s.paid_amount::float8 AS paid, s.voucher_id, s.invoice_number, to_char(s.invoice_date,'YYYY-MM-DD') AS invoice_date, p.name AS supplier
      FROM supplier_invoices s JOIN suppliers p ON p.id = s.supplier_id WHERE s.id = ${id} AND s.company_id = ${actor.companyId} FOR UPDATE OF s`;
    if (!i) throw new NotFoundError('Leverantörsfakturan');
    if (i.status === 'paid' || !i.voucher_id) throw new ConflictError('Bara bokförda, obetalda leverantörsfakturor kan få innehållna belopp');
    if (d < i.invoice_date) throw new ValidationError('Datumet kan inte vara före fakturadatumet');
    let amount: number;
    try { amount = retentionAmount(i.total, pct, i.total - i.paid); } catch (e) { throw new ValidationError((e as Error).message); }
    if (amount <= 0) throw new ValidationError('Det finns inget obetalt att hålla inne');
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${RETAINED_PAYABLE}, 'Innehållna belopp till leverantörer') ON CONFLICT DO NOTHING`;
    const v = await createVoucher(tx, { actor, date: d, description: `Innehållet belopp ${pct} % ${i.supplier} faktura ${i.invoice_number}`, lines: fromSigned(retentionLines('supplier', 'retain', amount)), sourceType: 'retention', sourceId: id });
    const [r] = await tx<{ id: number }[]>`INSERT INTO retentions ${tx({ company_id: actor.companyId, side: 'supplier', supplier_invoice_id: id, amount, pct, date: d,
      release_after: date(input, 'release_after', 'Släpps', false) || null, note: str(input, 'note', { max: 300 }), voucher_id: v.id })} RETURNING id`;
    const full = i.paid + amount >= i.total;
    await tx`UPDATE supplier_invoices SET paid_amount = paid_amount + ${amount}, status = ${full ? 'paid' : i.status}, paid_date = ${full ? d : null} WHERE id = ${id}`;
    await auditBy(tx, actor, 'retain', 'supplier_invoice', id, { amount, pct });
    return { id: r.id, amount };
  });
}

/** Frisläppt innehållet belopp: kunden betalar in, eller vi betalar ut till leverantören */
export async function release(actor: Actor, id: number, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum', false) || today();
  const bank = optInt(input, 'bank_account', 'Bankkonto') ?? 1930;
  if (bank < 1900 || bank > 1999) throw new ValidationError('Bankkontot ska vara 19xx');
  return sql.begin(async (tx) => {
    const [r] = await tx<{ side: 'customer' | 'supplier'; amount: number; released: string | null; date: string }[]>`
      SELECT side, amount::float8 AS amount, to_char(released_on,'YYYY-MM-DD') AS released, to_char(date,'YYYY-MM-DD') AS date FROM retentions WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!r) throw new NotFoundError('Det innehållna beloppet');
    if (r.released) throw new ConflictError('Beloppet är redan frisläppt');
    if (d < r.date) throw new ValidationError('Datumet kan inte vara före innehållandet');
    const v = await createVoucher(tx, { actor, date: d, description: r.side === 'customer' ? 'Inbetalt innehållet belopp från kund' : 'Utbetalt innehållet belopp till leverantör',
      lines: fromSigned(retentionLines(r.side, 'release', r.amount, bank)), sourceType: 'retention_release', sourceId: id, series: 'B' });
    await tx`UPDATE retentions SET released_on = ${d}, release_voucher_id = ${v.id} WHERE id = ${id}`;
    await auditBy(tx, actor, 'release', 'retention', id, { amount: r.amount });
  });
}

export async function retentions(companyId: number) {
  return sql<{ id: number; side: 'customer' | 'supplier'; counterpart: string; ref: string; amount: number; pct: number; date: string; release_after: string | null; released_on: string | null; note: string }[]>`
    SELECT r.id, r.side, COALESCE(c.name, p.name) AS counterpart, COALESCE(i.invoice_number::text, s.invoice_number) AS ref, r.amount::float8 AS amount, r.pct::float8 AS pct,
      to_char(r.date,'YYYY-MM-DD') AS date, to_char(r.release_after,'YYYY-MM-DD') AS release_after, to_char(r.released_on,'YYYY-MM-DD') AS released_on, r.note
    FROM retentions r LEFT JOIN invoices i ON i.id = r.invoice_id LEFT JOIN customers c ON c.id = i.customer_id
      LEFT JOIN supplier_invoices s ON s.id = r.supplier_invoice_id LEFT JOIN suppliers p ON p.id = s.supplier_id
    WHERE r.company_id = ${companyId} ORDER BY r.released_on NULLS FIRST, r.date DESC, r.id DESC`;
}

export async function openInvoices(companyId: number) {
  const customer = await sql<{ id: number; label: string }[]>`SELECT i.id, 'Faktura ' || i.invoice_number || ' ' || c.name || ' (' || to_char(i.total / 100.0, 'FM999G999G990D00') || ' kr)' AS label
    FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.company_id = ${companyId} AND i.status = 'booked' AND i.voucher_id IS NOT NULL AND i.currency = 'SEK' AND i.total > 0
      AND NOT EXISTS (SELECT 1 FROM retentions r WHERE r.invoice_id = i.id) ORDER BY i.invoice_date DESC LIMIT 200`;
  const supplier = await sql<{ id: number; label: string }[]>`SELECT s.id, p.name || ' ' || s.invoice_number || ' (' || to_char(s.total / 100.0, 'FM999G999G990D00') || ' kr)' AS label
    FROM supplier_invoices s JOIN suppliers p ON p.id = s.supplier_id WHERE s.company_id = ${companyId} AND s.status <> 'paid' AND s.voucher_id IS NOT NULL AND s.total > 0
      AND NOT EXISTS (SELECT 1 FROM retentions r WHERE r.supplier_invoice_id = s.id) ORDER BY s.invoice_date DESC LIMIT 200`;
  return { customer, supplier };
}

// ---------- Kontroll av omvänd byggmoms ----------
export async function invoiceRcCheck(companyId: number, invoiceId: number) {
  const [i] = await sql<{ rc_kind: string; orgnr: string; vat_number: string }[]>`SELECT i.rc_kind, c.orgnr, c.vat_number FROM invoices i JOIN customers c ON c.id = i.customer_id
    WHERE i.id = ${invoiceId} AND i.company_id = ${companyId}`;
  if (!i) return null;
  const lines = await sql<{ description: string }[]>`SELECT description FROM invoice_lines WHERE invoice_id = ${invoiceId} ORDER BY position`;
  const verdicts = rcCheck({ rcKind: i.rc_kind, customerIsCompany: !!(i.orgnr || i.vat_number), lines });
  return { rcKind: i.rc_kind, lines: lines.map((l, k) => ({ ...l, ...verdicts[k] })), warnings: verdicts.filter((v) => v.status === 'warn').length };
}
