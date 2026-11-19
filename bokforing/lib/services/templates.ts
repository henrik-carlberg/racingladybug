import 'server-only';
import { sql } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { DEFAULT_TEMPLATES, renderTemplate, type Template, type TemplateKind } from '@/lib/email-templates';
import type { Actor } from './actor';

/** Bolagets egen mall, eller null om standardtexten används */
export async function customTemplate(companyId: number, kind: TemplateKind): Promise<(Template & { enabled: boolean }) | null> {
  const [t] = await sql<(Template & { enabled: boolean })[]>`SELECT subject, body, enabled FROM email_templates WHERE company_id = ${companyId} AND kind = ${kind}`;
  return t ?? null;
}
export async function allTemplates(companyId: number) {
  const rows = await sql<{ kind: TemplateKind; subject: string; body: string; enabled: boolean }[]>`SELECT kind, subject, body, enabled FROM email_templates WHERE company_id = ${companyId}`;
  const custom = new Map(rows.map((r) => [r.kind, r]));
  return (Object.keys(DEFAULT_TEMPLATES) as TemplateKind[]).map((k) => ({ kind: k, custom: !!custom.get(k), enabled: custom.get(k)?.enabled ?? k !== 'thanks', ...(custom.get(k) ?? DEFAULT_TEMPLATES[k]) }));
}
export async function saveTemplate(actor: Actor, kind: TemplateKind, t: Template & { enabled: boolean }) {
  if (!t.subject.trim() || !t.body.trim()) throw new ValidationError('Ämne och text behövs');
  if (t.subject.length > 200 || t.body.length > 5000) throw new ValidationError('Mallen är för lång');
  await sql`INSERT INTO email_templates (company_id, kind, subject, body, enabled) VALUES (${actor.companyId}, ${kind}, ${t.subject.trim()}, ${t.body.trim()}, ${t.enabled})
    ON CONFLICT (company_id, kind) DO UPDATE SET subject = EXCLUDED.subject, body = EXCLUDED.body, enabled = EXCLUDED.enabled, updated_at = now()`;
  await auditBy(sql, actor, 'save', 'email_template', 0, { kind });
}
export async function resetTemplate(actor: Actor, kind: TemplateKind) {
  await sql`DELETE FROM email_templates WHERE company_id = ${actor.companyId} AND kind = ${kind}`;
}
export { renderTemplate };

/** Tack för betalningen (om bolaget har slagit på det) */
export async function sendThanks(companyId: number, invoiceId: number) {
  const tpl = await customTemplate(companyId, 'thanks');
  if (!tpl?.enabled) return false;
  const { sendMail } = await import('@/lib/server/mail');
  const { formatAmount } = await import('@/lib/money');
  const [i] = await sql<{ number: number; total: number; email: string; customer: string; company: string; bankgiro: string; ocr: string | null; due: string; language: string }[]>`
    SELECT i.invoice_number AS number, i.total::bigint AS total, c.email, c.name AS customer, co.name AS company, co.bankgiro, i.ocr, to_char(i.due_date,'YYYY-MM-DD') AS due, i.language
    FROM invoices i JOIN customers c ON c.id = i.customer_id JOIN companies co ON co.id = i.company_id WHERE i.id = ${invoiceId} AND i.company_id = ${companyId} AND i.status = 'paid'`;
  if (!i?.email || i.language === 'en') return false;
  const r = renderTemplate(tpl, { kund: i.customer, företag: i.company, fakturanummer: String(i.number), belopp: formatAmount(Number(i.total)) + ' kr', förfallodatum: i.due, ocr: i.ocr ?? '', bankgiro: i.bankgiro, länk: '', meddelande: '', att_betala: '0,00 kr' });
  return sendMail(i.email, r.subject, r.body);
}
