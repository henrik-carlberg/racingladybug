import 'server-only';
import { randomBytes } from 'node:crypto';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { apEnabled } from '@/lib/server/peppol-ap';
import { contentStatus, hasKivra, kivraConfigured, sendContent } from '@/lib/server/kivra';
import { chooseChannel, invoicePdf, mapKivraStatus, payslipPdf, recipientId, type Channel } from '@/lib/kivra';
import type { Actor } from './actor';
import { peppolCheck } from './einvoice';

async function invoiceData(companyId: number, invoiceId: number) {
  const [i] = await sql<{ id: number; status: string; number: number; date: string; due: string; total: number; vat: number; net: number; ocr: string | null; credit: boolean; token: string | null;
    customer: string; orgnr: string; email: string; address: string; postal: string; city: string; delivery: 'auto' | Channel; currency: string }[]>`
    SELECT i.id, i.status, i.invoice_number AS number, to_char(i.invoice_date,'YYYY-MM-DD') AS date, to_char(i.due_date,'YYYY-MM-DD') AS due, i.total::float8 AS total,
      i.total_vat::float8 AS vat, i.total_net::float8 AS net, i.ocr, i.credit_of_id IS NOT NULL AS credit, i.public_token AS token, c.name AS customer, c.orgnr, c.email,
      c.address, c.postal_code AS postal, c.city, c.delivery, i.currency
    FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ${invoiceId} AND i.company_id = ${companyId}`;
  if (!i) throw new NotFoundError('Fakturan');
  return i;
}

/** Vilka kanaler kan kunden ta emot fakturan i, och vilken väljs? */
export async function channelFor(companyId: number, invoiceId: number) {
  const i = await invoiceData(companyId, invoiceId);
  const peppol = apEnabled() && !(await peppolCheck(companyId, invoiceId).catch(() => ({ errors: ['x'] }))).errors.length;
  const rid = recipientId(i.orgnr);
  let kivra = false;
  if (kivraConfigured() && rid && i.currency === 'SEK') kivra = await hasKivra(rid).catch(() => false);
  const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(i.email);
  return { channel: chooseChannel({ preferred: i.delivery, peppol, kivra, email }), peppol, kivra, email, preferred: i.delivery };
}

export async function sendInvoiceKivra(actor: Actor, invoiceId: number, origin: string) {
  if (!kivraConfigured()) throw new ValidationError('Kivra är inte kopplat');
  const i = await invoiceData(actor.companyId, invoiceId);
  if (i.status === 'draft') throw new ConflictError('Bokför fakturan innan den skickas');
  const rid = recipientId(i.orgnr);
  if (!rid) throw new ValidationError('Kunden saknar person- eller organisationsnummer');
  if (!(await hasKivra(rid))) throw new ValidationError(`${i.customer} har inte Kivra`);
  if ((await sql`SELECT 1 FROM kivra_deliveries WHERE invoice_id = ${invoiceId} AND status <> 'failed'`).length) throw new ConflictError('Fakturan är redan skickad till Kivra');
  const [co] = await sql<{ name: string; orgnr: string; address: string; postal_code: string; city: string; bankgiro: string }[]>`SELECT name, orgnr, address, postal_code, city, bankgiro FROM companies WHERE id = ${actor.companyId}`;
  const lines = await sql<{ description: string; quantity: string; unit: string; unit_price: number }[]>`SELECT description, quantity, unit, unit_price::float8 AS unit_price FROM invoice_lines WHERE invoice_id = ${invoiceId} ORDER BY position`;
  const token = i.token ?? randomBytes(24).toString('base64url');
  if (!i.token) await sql`UPDATE invoices SET public_token = ${token} WHERE id = ${invoiceId}`;
  const pdf = invoicePdf({ company: co.name, orgnr: co.orgnr, address: [co.address, co.postal_code, co.city].filter(Boolean).join(' '), number: i.number, date: i.date, due: i.due,
    customer: i.customer, customerAddress: [i.address, i.postal, i.city].filter(Boolean).join(', '), credit: i.credit,
    lines: lines.map((l) => ({ description: l.description, quantity: Number(l.quantity), unit: l.unit, price: Number(l.unit_price), amount: Math.round(Number(l.quantity) * Number(l.unit_price)) })),
    net: i.net, vat: i.vat, total: i.total, bankgiro: co.bankgiro, ocr: i.ocr, link: `${origin}/f/${token}` });
  const [d] = await sql<{ id: number }[]>`INSERT INTO kivra_deliveries (company_id, kind, invoice_id, created_by) VALUES (${actor.companyId}, 'invoice', ${invoiceId}, ${actor.userId}) RETURNING id`;
  try {
    const key = await sendContent({ to: rid, subject: `${i.credit ? 'Kreditfaktura' : 'Faktura'} ${i.number} från ${co.name}`, type: 'invoice', pdf, filename: `faktura-${i.number}.pdf`,
      payment: i.credit || i.total <= 0 ? undefined : { amount: i.total, dueDate: i.due, ocr: i.ocr, bankgiro: co.bankgiro } });
    await sql`UPDATE kivra_deliveries SET content_key = ${key} WHERE id = ${d.id}`;
    await sql`UPDATE invoices SET sent_via = 'kivra' WHERE id = ${invoiceId}`;
    await auditBy(sql, actor, 'send_kivra', 'invoice', invoiceId);
  } catch (e) {
    await sql`UPDATE kivra_deliveries SET status = 'failed', message = ${e instanceof Error ? e.message.slice(0, 300) : 'Fel'} WHERE id = ${d.id}`;
    throw e;
  }
}

/** Lönebesked till de anställdas Kivra för en bokförd lönekörning (de som saknar Kivra hoppas över) */
export async function sendPayslipsKivra(actor: Actor, runId: number) {
  if (!kivraConfigured()) throw new ValidationError('Kivra är inte kopplat');
  const [run] = await sql<{ status: string; period: string; date: string }[]>`SELECT status, period, to_char(payment_date,'YYYY-MM-DD') AS date FROM payroll_runs WHERE id = ${runId} AND company_id = ${actor.companyId}`;
  if (!run) throw new NotFoundError('Lönekörningen');
  if (run.status !== 'booked') throw new ConflictError('Bokför lönekörningen först');
  const [co] = await sql<{ name: string }[]>`SELECT name FROM companies WHERE id = ${actor.companyId}`;
  const slips = await sql<{ id: number; name: string; pnr: string; items: { description: string; amount: number }[]; gross: number; tax: number; net: number }[]>`
    SELECT p.id, e.first_name || ' ' || e.last_name AS name, e.personal_number AS pnr, p.items, (p.gross_cash + p.benefits)::float8 AS gross, p.tax::float8 AS tax, p.net_pay::float8 AS net
    FROM payslips p JOIN employees e ON e.id = p.employee_id WHERE p.run_id = ${runId}
      AND NOT EXISTS (SELECT 1 FROM kivra_deliveries k WHERE k.payslip_id = p.id AND k.status <> 'failed')`;
  let sent = 0; const skipped: string[] = [];
  for (const s of slips) {
    const rid = recipientId(s.pnr);
    if (!rid || rid.type !== 'person' || !(await hasKivra(rid).catch(() => false))) { skipped.push(s.name); continue; }
    const [d] = await sql<{ id: number }[]>`INSERT INTO kivra_deliveries (company_id, kind, payslip_id, created_by) VALUES (${actor.companyId}, 'payslip', ${s.id}, ${actor.userId}) RETURNING id`;
    try {
      const key = await sendContent({ to: rid, subject: `Lönebesked ${run.period} från ${co.name}`, type: 'salary', filename: `lonebesked-${run.period}.pdf`,
        pdf: payslipPdf({ company: co.name, employee: s.name, period: run.period, paymentDate: run.date, items: (s.items ?? []).map((x) => ({ description: String(x.description ?? ''), amount: Number(x.amount ?? 0) })), gross: s.gross, tax: s.tax, net: s.net }) });
      await sql`UPDATE kivra_deliveries SET content_key = ${key} WHERE id = ${d.id}`;
      sent++;
    } catch (e) { await sql`UPDATE kivra_deliveries SET status = 'failed', message = ${e instanceof Error ? e.message.slice(0, 300) : 'Fel'} WHERE id = ${d.id}`; skipped.push(s.name); }
  }
  await auditBy(sql, actor, 'send_kivra', 'payroll_run', runId, { sent, skipped: skipped.length });
  return { sent, skipped };
}

/** Status från Kivra (levererad, öppnad) – på begäran och varje natt */
export async function refreshKivra(companyId?: number) {
  let n = 0;
  for (const d of await sql<{ id: number; key: string; status: string }[]>`SELECT id, content_key AS key, status FROM kivra_deliveries WHERE status IN ('sent','delivered') AND content_key IS NOT NULL
      AND created_at > now() - interval '60 days' ${companyId ? sql`AND company_id = ${companyId}` : sql``}`) {
    try {
      const st = mapKivraStatus(await contentStatus(d.key));
      if (st !== d.status) { await sql`UPDATE kivra_deliveries SET status = ${st}, updated_at = now() WHERE id = ${d.id}`; n++; }
    } catch (e) { console.error('kivra', e instanceof Error ? e.message : e); }
  }
  return n;
}

export async function deliveriesFor(companyId: number, f: { invoiceId?: number; runId?: number }) {
  return [...await sql<{ id: number; kind: string; status: string; message: string; name: string | null; created: string; updated: string }[]>`
    SELECT k.id, k.kind, k.status, k.message, e.first_name || ' ' || e.last_name AS name, to_char(k.created_at,'YYYY-MM-DD HH24:MI') AS created, to_char(k.updated_at,'YYYY-MM-DD HH24:MI') AS updated
    FROM kivra_deliveries k LEFT JOIN payslips p ON p.id = k.payslip_id LEFT JOIN employees e ON e.id = p.employee_id
    WHERE k.company_id = ${companyId} ${f.invoiceId ? sql`AND k.invoice_id = ${f.invoiceId}` : sql``} ${f.runId ? sql`AND p.run_id = ${f.runId}` : sql``} ORDER BY k.id DESC LIMIT 100`];
}
