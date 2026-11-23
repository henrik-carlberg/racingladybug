import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { STATUS, bidMargin, capStatus, daysTo, expiring, winRate } from '@/lib/tenders';
import type { Actor } from './actor';
import { date, int, optInt, str } from './input';

const kr = (v: unknown, label: string, zero = false) => { const n = parseAmount(String(v ?? '').trim() || (zero ? '0' : '')); if (n == null || n < 0 || (!zero && !n)) throw new ValidationError(`Ange ${label} i kronor`); return n; };

export async function overview(companyId: number) {
  const t = today();
  const tenders = await sql<{ id: number; customer: string; customer_id: number; title: string; due_date: string; cost: number; bid: number; status: string; decided_on: string | null; agreement_id: number | null }[]>`
    SELECT x.id, c.name AS customer, x.customer_id, x.title, to_char(x.due_date,'YYYY-MM-DD') AS due_date, x.cost::float8 AS cost, x.bid::float8 AS bid, x.status, to_char(x.decided_on,'YYYY-MM-DD') AS decided_on,
      (SELECT a.id FROM framework_agreements a WHERE a.tender_id = x.id LIMIT 1) AS agreement_id
    FROM tenders x JOIN customers c ON c.id = x.customer_id WHERE x.company_id = ${companyId} ORDER BY x.status IN ('draft','submitted') DESC, x.due_date DESC LIMIT 200`;
  const agreements = await sql<{ id: number; customer: string; customer_id: number; name: string; cap: number; start: string; end: string; warn_pct: number; used: number; calls: number }[]>`
    SELECT a.id, c.name AS customer, a.customer_id, a.name, a.cap::float8 AS cap, to_char(a.start_date,'YYYY-MM-DD') AS start, to_char(a.end_date,'YYYY-MM-DD') AS end, a.warn_pct,
      COALESCE((SELECT SUM(i.total_net) FROM framework_calls f JOIN invoices i ON i.id = f.invoice_id WHERE f.agreement_id = a.id AND i.status <> 'draft'), 0)::float8 AS used,
      (SELECT count(*)::int FROM framework_calls f WHERE f.agreement_id = a.id) AS calls
    FROM framework_agreements a JOIN customers c ON c.id = a.customer_id WHERE a.company_id = ${companyId} ORDER BY a.end_date`;
  const invoices = await sql<{ id: number; customer_id: number; number: number; net: number; date: string }[]>`SELECT i.id, i.customer_id, i.invoice_number AS number, i.total_net::float8 AS net, to_char(i.invoice_date,'YYYY-MM-DD') AS date
    FROM invoices i WHERE i.company_id = ${companyId} AND i.status IN ('booked','paid','credited') AND NOT EXISTS (SELECT 1 FROM framework_calls f WHERE f.invoice_id = i.id) ORDER BY i.invoice_date DESC LIMIT 300`;
  const customers = await sql<{ id: number; name: string }[]>`SELECT id, name FROM customers WHERE company_id = ${companyId} ORDER BY name LIMIT 500`;
  return {
    customers, winRate: winRate(tenders.map((x) => x.status)),
    tenders: tenders.map((x) => ({ ...x, margin: bidMargin(x.bid, x.cost), days: daysTo(x.due_date, t) })),
    agreements: agreements.map((a) => ({ ...a, ...capStatus(a.used, a.cap, a.warn_pct), active: a.start <= t && a.end >= t, expiring: a.end >= t && expiring(a.end, t), invoices: invoices.filter((i) => i.customer_id === a.customer_id && i.date >= a.start && i.date <= a.end) })),
  };
}

export async function addTender(actor: Actor, input: Record<string, unknown>) {
  const customerId = int(input, 'customer_id', 'Kund');
  const [c] = await sql`SELECT 1 FROM customers WHERE id = ${customerId} AND company_id = ${actor.companyId}`;
  if (!c) throw new NotFoundError('Kunden');
  await sql`INSERT INTO tenders ${sql({ company_id: actor.companyId, customer_id: customerId, title: str(input, 'title', { required: true, label: 'Upphandling', max: 300 }), due_date: date(input, 'due_date', 'Sista dag'),
    cost: kr(input.cost, 'kalkylerad kostnad', true), bid: kr(input.bid, 'anbudssumman'), created_by: actor.userId })}`;
}

export async function setStatus(actor: Actor, id: number, input: Record<string, unknown>) {
  const status = String(input.status ?? '');
  if (!Object.prototype.hasOwnProperty.call(STATUS, status)) throw new ValidationError('Okänd status');
  const r = await sql`UPDATE tenders SET status = ${status}, decided_on = ${['won', 'lost', 'withdrawn'].includes(status) ? today() : null} WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!r.count) throw new NotFoundError('Anbudet');
}

/** Ramavtal – från ett vunnet anbud eller fristående */
export async function addAgreement(actor: Actor, input: Record<string, unknown>) {
  const tenderId = optInt(input, 'tender_id', 'Anbud');
  let customerId = optInt(input, 'customer_id', 'Kund');
  let name = str(input, 'name', { max: 300 });
  if (tenderId) {
    const [x] = await sql<{ customer_id: number; title: string; status: string }[]>`SELECT customer_id, title, status FROM tenders WHERE id = ${tenderId} AND company_id = ${actor.companyId}`;
    if (!x) throw new NotFoundError('Anbudet');
    if (x.status !== 'won') throw new ConflictError('Bara vunna anbud blir ramavtal');
    customerId = x.customer_id; name = name || x.title;
  }
  if (!customerId) throw new ValidationError('Välj kund');
  const [c] = await sql`SELECT 1 FROM customers WHERE id = ${customerId} AND company_id = ${actor.companyId}`;
  if (!c) throw new NotFoundError('Kunden');
  if (!name) throw new ValidationError('Ange avtalets namn');
  const start = date(input, 'start_date', 'Avtalet börjar'), end = date(input, 'end_date', 'Avtalet slutar');
  if (end < start) throw new ValidationError('Avtalet slutar före det börjar');
  const warn = Number(input.warn_pct ?? 80);
  if (!Number.isInteger(warn) || warn < 1 || warn > 100) throw new ValidationError('Varningsgränsen ska vara 1–100 %');
  await sql`INSERT INTO framework_agreements ${sql({ company_id: actor.companyId, customer_id: customerId, tender_id: tenderId, name, cap: kr(input.cap, 'takbeloppet'), start_date: start, end_date: end, warn_pct: warn, created_by: actor.userId })}`;
}

/** Faktura som avropar mot ramavtalet (samma kund, inom avtalsperioden) */
export async function attach(actor: Actor, agreementId: number, input: Record<string, unknown>) {
  const invoiceId = int(input, 'invoice_id', 'Faktura');
  return sql.begin(async (tx) => {
    const [a] = await tx<{ customer_id: number; start: string; end: string; cap: number; warn_pct: number }[]>`SELECT customer_id, to_char(start_date,'YYYY-MM-DD') AS start, to_char(end_date,'YYYY-MM-DD') AS end, cap::float8 AS cap, warn_pct
      FROM framework_agreements WHERE id = ${agreementId} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!a) throw new NotFoundError('Ramavtalet');
    const [i] = await tx<{ customer_id: number; date: string; status: string }[]>`SELECT customer_id, to_char(invoice_date,'YYYY-MM-DD') AS date, status FROM invoices WHERE id = ${invoiceId} AND company_id = ${actor.companyId}`;
    if (!i) throw new NotFoundError('Fakturan');
    if (i.customer_id !== a.customer_id) throw new ValidationError('Fakturan är ställd till en annan kund');
    if (i.date < a.start || i.date > a.end) throw new ValidationError('Fakturan ligger utanför avtalsperioden');
    if (i.status === 'draft') throw new ValidationError('Bokför fakturan först');
    try { await tx`INSERT INTO framework_calls (agreement_id, invoice_id) VALUES (${agreementId}, ${invoiceId})`; }
    catch (e) { if (String((e as Error).message).includes('framework_calls_invoice_id_key')) throw new ConflictError('Fakturan är redan kopplad till ett ramavtal'); throw e; }
    const [{ used }] = await tx<{ used: number }[]>`SELECT COALESCE(SUM(i.total_net), 0)::float8 AS used FROM framework_calls f JOIN invoices i ON i.id = f.invoice_id WHERE f.agreement_id = ${agreementId} AND i.status <> 'draft'`;
    await auditBy(tx, actor, 'framework_call', 'framework_agreement', agreementId, { invoice: invoiceId });
    return capStatus(used, a.cap, a.warn_pct);
  });
}

export async function extend(actor: Actor, agreementId: number, input: Record<string, unknown>) {
  const end = date(input, 'end_date', 'Nytt slutdatum');
  const r = await sql`UPDATE framework_agreements SET end_date = ${end} WHERE id = ${agreementId} AND company_id = ${actor.companyId} AND ${end}::date > end_date`;
  if (!r.count) throw new ValidationError('Det nya slutdatumet ska vara senare än det nuvarande');
}
