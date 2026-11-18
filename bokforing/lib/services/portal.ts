import 'server-only';
import { randomBytes } from 'node:crypto';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { enabledModules } from '@/lib/modules/enabled';
import { canPayByCard } from './payments';
import type { Actor } from './actor';

export async function portalLink(actor: Actor, customerId: number, rotate = false): Promise<string> {
  const [c] = await sql<{ token: string | null }[]>`SELECT portal_token AS token FROM customers WHERE id = ${customerId} AND company_id = ${actor.companyId}`;
  if (!c) throw new NotFoundError('Kunden');
  if (c.token && !rotate) return c.token;
  const token = randomBytes(24).toString('base64url');
  await sql`UPDATE customers SET portal_token = ${token} WHERE id = ${customerId}`;
  await auditBy(sql, actor, rotate ? 'rotate_portal' : 'create_portal', 'customer', customerId);
  return token;
}

export async function portalByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [r] = await sql<{ customer_id: number; company_id: number; customer: string; email: string; address: string; postal_code: string; city: string;
    company: string; company_email: string; company_phone: string; bankgiro: string; owner: number | null }[]>`
    SELECT cu.id AS customer_id, cu.company_id, cu.name AS customer, cu.email, cu.address, cu.postal_code, cu.city,
      co.name AS company, co.email AS company_email, co.phone AS company_phone, co.bankgiro,
      (SELECT m.user_id FROM memberships m WHERE m.company_id = co.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1) AS owner
    FROM customers cu JOIN companies co ON co.id = cu.company_id WHERE cu.portal_token = ${token}`;
  return r ?? null;
}

/** Kundens fakturor (bokförda, betalda och krediterade). Fakturor som saknar publik länk får en. */
export async function portalInvoices(companyId: number, customerId: number) {
  const rows = await sql<{ id: number; number: number; invoice_date: string; due_date: string; total: number; remaining: number; status: string; ocr: string | null; public_token: string | null; credit_of_id: number | null }[]>`
    SELECT id, invoice_number AS number, to_char(invoice_date,'YYYY-MM-DD') AS invoice_date, to_char(due_date,'YYYY-MM-DD') AS due_date, total, (total - paid_amount)::bigint AS remaining, status, ocr, public_token, credit_of_id
    FROM invoices WHERE company_id = ${companyId} AND customer_id = ${customerId} AND status <> 'draft' ORDER BY invoice_date DESC, id DESC LIMIT 100`;
  for (const r of rows) {
    if (!r.public_token) {
      r.public_token = randomBytes(24).toString('base64url');
      await sql`UPDATE invoices SET public_token = ${r.public_token} WHERE id = ${r.id} AND public_token IS NULL`;
    }
  }
  return Promise.all(rows.map(async (r) => ({ ...r, card: r.status === 'booked' ? await canPayByCard(r.id) : false })));
}

/** Öppna offerter (CRM) till kunden med offertrader och giltighetstid som inte har passerat */
export async function portalQuotes(companyId: number, customerId: number) {
  if (!(await enabledModules(companyId)).some((m) => m.id === 'crm')) return [];
  const deals = await sql<{ id: number; title: string; valid_to: string | null; notes: string; kind: string; accepted_at: string | null; accepted_by: string | null }[]>`
    SELECT d.id, d.title, to_char(d.quote_valid_to,'YYYY-MM-DD') AS valid_to, d.quote_notes AS notes, s.kind,
      to_char(a.accepted_at AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD HH24:MI') AS accepted_at, a.accepted_by
    FROM crm_deals d JOIN crm_stages s ON s.id = d.stage_id LEFT JOIN portal_quote_acceptances a ON a.deal_id = d.id
    WHERE d.company_id = ${companyId} AND d.customer_id = ${customerId} AND EXISTS (SELECT 1 FROM crm_quote_lines q WHERE q.deal_id = d.id)
      AND (s.kind = 'open' OR a.id IS NOT NULL) ORDER BY d.created_at DESC`;
  const out = [];
  for (const d of deals) {
    const lines = await sql<{ description: string; quantity: number; unit: string; unit_price: number; vat_rate: number }[]>`
      SELECT description, quantity::float8 AS quantity, unit, unit_price::int AS unit_price, vat_rate FROM crm_quote_lines WHERE deal_id = ${d.id} ORDER BY position`;
    const net = lines.reduce((s, l) => s + Math.round(l.quantity * l.unit_price), 0);
    const vat = lines.reduce((s, l) => s + Math.round((Math.round(l.quantity * l.unit_price) * l.vat_rate) / 100), 0);
    out.push({ ...d, lines, net, vat, total: net + vat, expired: !!d.valid_to && d.valid_to < new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' }) });
  }
  return out;
}

/** Kunden godkänner offerten: affären markeras som vunnen och godkännandet sparas (namn, tid, IP) */
export async function acceptQuote(token: string, dealId: number, name: string, ip: string) {
  const p = await portalByToken(token);
  if (!p || !p.owner) throw new NotFoundError('Portalen');
  if (!name.trim()) throw new ValidationError('Skriv ditt namn för att godkänna offerten');
  const quote = (await portalQuotes(p.company_id, p.customer_id)).find((q) => q.id === dealId);
  if (!quote) throw new NotFoundError('Offerten');
  if (quote.accepted_at) throw new ConflictError('Offerten är redan godkänd');
  if (quote.expired) throw new ValidationError('Offerten har gått ut – kontakta oss för en ny');
  const { moveDeal, stages } = await import('@/modules/crm/pipeline');
  const actor: Actor = { companyId: p.company_id, userId: p.owner, apiKeyId: null, role: 'owner' };
  const [deal] = await sql<{ pipeline_id: number }[]>`SELECT s.pipeline_id FROM crm_deals d JOIN crm_stages s ON s.id = d.stage_id WHERE d.id = ${dealId}`;
  const won = (await stages(sql, p.company_id)).find((s) => s.pipeline_id === deal.pipeline_id && s.kind === 'won');
  if (!won) throw new ValidationError('Pipelinen saknar fasen Vunnen');
  await sql`INSERT INTO portal_quote_acceptances (company_id, customer_id, deal_id, accepted_by, total, ip) VALUES (${p.company_id}, ${p.customer_id}, ${dealId}, ${name.trim().slice(0, 120)}, ${quote.total}, ${ip.slice(0, 60)})`;
  await moveDeal(actor, dealId, { stage_id: won.id });
  await auditBy(sql, actor, 'quote_accepted', 'crm.deal', dealId, { by: name.trim(), via: 'portal' });
}

/** Kunden uppdaterar sina kontaktuppgifter */
export async function updateContact(token: string, input: { email: string; address: string; postal_code: string; city: string }) {
  const p = await portalByToken(token);
  if (!p || !p.owner) throw new NotFoundError('Portalen');
  if (input.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) throw new ValidationError('Ogiltig e-postadress');
  await sql`UPDATE customers SET email = ${input.email.trim()}, address = ${input.address.trim()}, postal_code = ${input.postal_code.trim()}, city = ${input.city.trim()} WHERE id = ${p.customer_id}`;
  await auditBy(sql, { companyId: p.company_id, userId: p.owner, apiKeyId: null, role: 'owner' }, 'portal_update_contact', 'customer', p.customer_id, input);
}
