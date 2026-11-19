import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { apEnabled, apLookup, apMapStatus, apSend, apStatus, isParticipant } from '@/lib/server/peppol-ap';
import type { Actor } from './actor';
import { peppolCheck, peppolFile } from './einvoice';
import { addDocument } from './inbox';
import { requireVerified } from './identity';

/** Svenska organisationer adresseras med schema 0007 och organisationsnumret */
export const participantFor = (orgnr: string) => `0007:${orgnr.replace(/\D/g, '')}`;
const notEnabled = () => new ValidationError('Peppol-åtkomstpunkt är inte uppsatt – ladda ner XML-filen och skicka via din operatör');

/** Slår upp kunden i Peppol (sparat Peppol-ID, annars organisationsnumret) och sparar ID:t om kunden kan ta emot fakturor */
export async function lookupCustomer(actor: Actor, customerId: number) {
  if (!apEnabled()) throw notEnabled();
  const [c] = await sql<{ orgnr: string; peppol_id: string }[]>`SELECT orgnr, peppol_id FROM customers WHERE id = ${customerId} AND company_id = ${actor.companyId}`;
  if (!c) throw new NotFoundError('Kunden');
  const id = c.peppol_id || (c.orgnr.replace(/\D/g, '').length === 10 ? participantFor(c.orgnr) : '');
  if (!id) throw new ValidationError('Kunden saknar organisationsnummer och Peppol-ID');
  const r = await apLookup(id);
  if (r.registered && r.canReceiveInvoice && id !== c.peppol_id) {
    await sql`UPDATE customers SET peppol_id = ${id} WHERE id = ${customerId}`;
    await auditBy(sql, actor, 'peppol_lookup', 'customer', customerId, { peppol_id: id });
  }
  return { id, ...r };
}

export async function sendInvoice(actor: Actor, invoiceId: number) {
  if (!apEnabled()) throw notEnabled();
  // Avsändar-ID:t är bolagets organisationsnummer – bara ett verifierat bolag får skicka i dess namn
  await requireVerified(actor.companyId, 'E-faktura via Peppol');
  const [prev] = await sql<{ status: string }[]>`SELECT status FROM peppol_messages WHERE invoice_id = ${invoiceId} AND company_id = ${actor.companyId} AND direction = 'out' AND status <> 'failed' LIMIT 1`;
  if (prev) throw new ConflictError('Fakturan är redan skickad via Peppol');
  const f = await peppolFile(actor.companyId, invoiceId);
  const { data } = await peppolCheck(actor.companyId, invoiceId);
  const to = data.buyer.endpoint || (data.buyer.orgnr.replace(/\D/g, '').length === 10 ? participantFor(data.buyer.orgnr) : '');
  if (!isParticipant(to)) throw new ValidationError('Kunden saknar Peppol-ID – slå upp kunden först');
  const [co] = await sql<{ orgnr: string }[]>`SELECT orgnr FROM companies WHERE id = ${actor.companyId}`;
  const s = await apSend({ sender: participantFor(co.orgnr), receiver: to, xml: f.xml, documentType: f.filename.startsWith('kreditnota') ? 'creditnote' : 'invoice' });
  const [m] = await sql<{ id: number }[]>`INSERT INTO peppol_messages (company_id, direction, invoice_id, external_id, sender, receiver, status, message, created_by)
    VALUES (${actor.companyId}, 'out', ${invoiceId}, ${s.id || null}, ${participantFor(co.orgnr)}, ${to}, ${s.status}, ${s.message}, ${actor.userId}) RETURNING id`;
  if (s.status !== 'failed') await sql`UPDATE invoices SET sent_at = COALESCE(sent_at, now()) WHERE id = ${invoiceId}`.catch(() => {});
  await auditBy(sql, actor, 'peppol_send', 'invoice', invoiceId, { receiver: to, status: s.status });
  return { ...s, id: m.id };
}

/** Hämtar leveransstatus för skickade fakturor som ännu inte är levererade */
export async function refreshStatuses(companyId?: number, limit = 50) {
  if (!apEnabled()) return 0;
  const rows = await sql<{ id: number; external_id: string }[]>`SELECT id, external_id FROM peppol_messages WHERE direction = 'out' AND status = 'sent' AND external_id IS NOT NULL
    ${companyId ? sql`AND company_id = ${companyId}` : sql``} AND created_at > now() - interval '30 days' ORDER BY id LIMIT ${limit}`;
  let n = 0;
  for (const r of rows) {
    try {
      const s = await apStatus(r.external_id);
      if (s.status !== 'sent') { await sql`UPDATE peppol_messages SET status = ${s.status}, message = ${s.message}, updated_at = now() WHERE id = ${r.id}`; n++; }
    } catch (e) { console.error('peppol status', r.id, e instanceof Error ? e.message : e); }
  }
  return n;
}

interface ApEvent { type: string; id?: string; sender?: string; receiver?: string; document?: string; status?: string; message?: string }
/** Webhook från åtkomstpunkten: mottagen e-faktura eller ändrad leveransstatus. Returnerar nya inkorgsdokument. */
export async function handleApEvent(e: ApEvent): Promise<number[]> {
  if (!e.id || typeof e.id !== 'string' || e.id.length > 200) return [];
  if (e.type === 'document.status') {
    await sql`UPDATE peppol_messages SET status = ${apMapStatus(e.status)}, message = ${String(e.message ?? '').slice(0, 500)}, updated_at = now() WHERE direction = 'out' AND external_id = ${e.id}`;
    return [];
  }
  if (e.type !== 'document.received' || !e.receiver || !e.document) return [];
  const m = /^0007:(\d{10})$/.exec(e.receiver);
  if (!m) return [];
  // Endast det verifierade bolaget med organisationsnumret tar emot (högst ett, unikt index) – aldrig alla med samma nummer
  const companies = await sql<{ id: number }[]>`SELECT id FROM companies WHERE identity_verified_at IS NOT NULL AND NOT is_demo AND regexp_replace(orgnr, '\\D', '', 'g') = ${m[1]} LIMIT 1`;
  if (!companies.length) console.warn('peppol: ingen verifierad mottagare för', e.receiver);
  const xml = Buffer.from(e.document, 'base64');
  const ids: number[] = [];
  for (const c of companies) {
    const [dup] = await sql`SELECT 1 FROM peppol_messages WHERE company_id = ${c.id} AND direction = 'in' AND external_id = ${e.id}`;
    if (dup) continue;
    const doc = await addDocument(c.id, { source: 'peppol', messageId: `peppol:${e.id}`, from: String(e.sender ?? '').slice(0, 100), subject: 'E-faktura via Peppol', filename: `peppol-${e.id.replace(/[^A-Za-z0-9.-]/g, '_').slice(0, 60)}.xml`, mimeType: 'application/xml', data: xml });
    await sql`INSERT INTO peppol_messages (company_id, direction, inbox_document_id, external_id, sender, receiver, status) VALUES (${c.id}, 'in', ${doc}, ${e.id}, ${String(e.sender ?? '').slice(0, 100)}, ${e.receiver}, 'received') ON CONFLICT DO NOTHING`;
    if (doc) ids.push(doc);
  }
  return ids;
}

export async function listMessages(companyId: number) {
  return [...await sql<{ id: number; direction: 'out' | 'in'; invoice_id: number | null; invoice_number: number | null; inbox_document_id: number | null; sender: string; receiver: string; status: string; message: string; created_at: string; updated_at: string }[]>`
    SELECT m.id, m.direction, m.invoice_id, i.invoice_number, m.inbox_document_id, m.sender, m.receiver, m.status, m.message, to_char(m.created_at,'YYYY-MM-DD HH24:MI') AS created_at, to_char(m.updated_at,'YYYY-MM-DD HH24:MI') AS updated_at
    FROM peppol_messages m LEFT JOIN invoices i ON i.id = m.invoice_id WHERE m.company_id = ${companyId} ORDER BY m.created_at DESC LIMIT 200`];
}
export async function invoiceMessage(companyId: number, invoiceId: number) {
  const [m] = await sql<{ status: string; message: string; receiver: string; updated_at: string }[]>`SELECT status, message, receiver, to_char(updated_at,'YYYY-MM-DD HH24:MI') AS updated_at FROM peppol_messages
    WHERE company_id = ${companyId} AND invoice_id = ${invoiceId} AND direction = 'out' ORDER BY id DESC LIMIT 1`;
  return m ?? null;
}
