import 'server-only';
import { randomBytes } from 'node:crypto';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { sendMail } from '@/lib/server/mail';
import { formatAmount } from '@/lib/money';
import type { Actor } from './actor';
import { customTemplate, renderTemplate } from './templates';

/** Skapar (vid behov) en hemlig länk till fakturan och skickar den med e-post till kunden */
export async function sendInvoice(actor: Actor, invoiceId: number, input: { to?: string; message?: string }, origin: string) {
  const [i] = await sql<{ status: string; number: number; total: number; due: string; ocr: string | null; token: string | null; customer: string; email: string; credit: boolean; language: string; currency: string; total_currency: number | null }[]>`
    SELECT i.status, i.invoice_number AS number, i.total::bigint AS total, i.language, i.currency, i.total_currency, to_char(i.due_date,'YYYY-MM-DD') AS due, i.ocr, i.public_token AS token, c.name AS customer, c.email,
      i.credit_of_id IS NOT NULL AS credit
    FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ${invoiceId} AND i.company_id = ${actor.companyId}`;
  if (!i) throw new NotFoundError('Fakturan');
  if (i.status === 'draft') throw new ConflictError('Bokför fakturan innan den skickas');
  const to = (input.to ?? i.email ?? '').trim();
  if (to && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new ValidationError('Ogiltig e-postadress');
  const token = i.token ?? randomBytes(24).toString('base64url');
  const link = `${origin}/f/${token}`;
  const [co] = await sql<{ name: string; bankgiro: string; plusgiro: string; email: string; iban: string; bic: string }[]>`SELECT name, bankgiro, plusgiro, email, iban, bic FROM companies WHERE id = ${actor.companyId}`;
  const en = i.language === 'en';
  const kind = i.credit ? (en ? 'Credit note' : 'Kreditfaktura') : en ? 'Invoice' : 'Faktura';
  const amount = i.currency !== 'SEK' && i.total_currency != null ? `${formatAmount(Number(i.total_currency))} ${i.currency}` : `${formatAmount(Number(i.total))} kr`;
  const lines = en ? [
    `Dear ${i.customer},`, '',
    input.message?.trim() || `Please find ${kind.toLowerCase()} ${i.number} from ${co.name}.`, '',
    `${kind} ${i.number}: ${amount}`,
    !i.credit ? `Due date: ${i.due}` : '',
    !i.credit && co.iban ? `Pay to IBAN ${co.iban}${co.bic ? ` (BIC ${co.bic})` : ''}${i.ocr ? `, reference ${i.ocr}` : ''}.` : !i.credit && co.bankgiro ? `Pay to bankgiro ${co.bankgiro}${i.ocr ? `, reference ${i.ocr}` : ''}.` : '',
    '', `View, print or save the invoice as PDF: ${link}`, '',
    `Kind regards,\n${co.name}${co.email ? `\n${co.email}` : ''}`,
  ] : [
    `Hej ${i.customer},`, '',
    input.message?.trim() || `Här kommer ${kind.toLowerCase()} ${i.number} från ${co.name}.`, '',
    `${kind} ${i.number}: ${amount}`,
    !i.credit ? `Förfallodatum: ${i.due}` : '',
    !i.credit && co.bankgiro ? `Betala till bankgiro ${co.bankgiro}${i.ocr ? ` med OCR ${i.ocr}` : ''}.` : '',
    '', `Visa, skriv ut eller spara fakturan som PDF: ${link}`, '',
    `Med vänliga hälsningar\n${co.name}${co.email ? `\n${co.email}` : ''}`,
  ];
  let text = lines.filter((x, n, a) => x !== '' || a[n - 1] !== '').join('\n');
  let subject = `${kind} ${i.number} ${en ? 'from' : 'från'} ${co.name}`;
  // Egen mall för svenska fakturor (inte kreditfakturor)
  const tpl = !en && !i.credit ? await customTemplate(actor.companyId, 'invoice') : null;
  if (tpl?.enabled) {
    const r = renderTemplate(tpl, { kund: i.customer, företag: co.name, fakturanummer: String(i.number), belopp: amount, förfallodatum: i.due, ocr: i.ocr ?? '', bankgiro: co.bankgiro, länk: link, meddelande: input.message?.trim() ?? '', att_betala: amount });
    subject = r.subject; text = r.body;
  }
  const emailed = to ? await sendMail(to, subject, text) : false;
  await sql`UPDATE invoices SET public_token = ${token}, sent_at = ${emailed ? new Date() : sql`sent_at`}, sent_to = ${emailed ? to : sql`sent_to`} WHERE id = ${invoiceId}`;
  await auditBy(sql, actor, emailed ? 'send' : 'share_link', 'invoice', invoiceId, { to: emailed ? to : null });
  return { link, emailed, to };
}

export async function invoiceByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [r] = await sql<{ id: number; company_id: number }[]>`SELECT id, company_id FROM invoices WHERE public_token = ${token} AND status <> 'draft'`;
  return r ?? null;
}
