import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { INBOX_MAX_BYTES, INBOX_TYPES, inboxAddress, mimeFor, newInboxToken, tokensIn, type Extracted } from '@/lib/inbox';
import { ExtractionError, extractInvoice, invoiceAiEnabled } from './invoice-ai';
import { parseUbl } from '@/lib/peppol-in';
import { createSupplier, registerSupplierInvoice } from './suppliers';
import type { Actor } from './actor';

export const inboxDomain = () => (process.env.INBOX_DOMAIN || '').trim().toLowerCase();

/** Bolagets e-postadress för leverantörsfakturor (skapas första gången), eller null om e-postmottagning inte är uppsatt */
export async function companyInboxAddress(companyId: number): Promise<string | null> {
  const domain = inboxDomain();
  if (!domain) return null;
  let [c] = await sql<{ token: string | null }[]>`SELECT inbox_token AS token FROM companies WHERE id = ${companyId}`;
  if (!c.token) [c] = await sql<{ token: string }[]>`UPDATE companies SET inbox_token = COALESCE(inbox_token, ${newInboxToken()}) WHERE id = ${companyId} RETURNING inbox_token AS token`;
  return inboxAddress(c.token!, domain);
}

export async function newInboxAddress(actor: Actor) {
  await sql`UPDATE companies SET inbox_token = ${newInboxToken()} WHERE id = ${actor.companyId}`;
  await auditBy(sql, actor, 'rotate_inbox_address', 'company', actor.companyId);
}

interface NewDoc { source: 'email' | 'upload'; messageId?: string | null; from?: string; subject?: string; filename: string; mimeType: string; data: Buffer | null; uploadedBy?: number | null; error?: string }

export async function addDocument(companyId: number, d: NewDoc): Promise<number | null> {
  const mime = mimeFor(d.filename, d.mimeType);
  let error = d.error ?? '';
  let data = d.data;
  if (data && !INBOX_TYPES[mime]) { error = `Filtypen ${mime || 'okänd'} stöds inte – skicka PDF, JPG, PNG eller e-faktura (XML)`; data = null; }
  if (data && data.length > INBOX_MAX_BYTES) { error = 'Filen är större än 10 MB'; data = null; }
  const [r] = await sql<{ id: number }[]>`
    INSERT INTO inbox_documents (company_id, source, message_id, from_address, subject, filename, mime_type, data, status, error, uploaded_by)
    VALUES (${companyId}, ${d.source}, ${d.messageId ?? null}, ${(d.from ?? '').slice(0, 200)}, ${(d.subject ?? '').slice(0, 300)}, ${d.filename.slice(0, 200)},
      ${mime}, ${data}, ${data ? 'new' : 'failed'}, ${error}, ${d.uploadedBy ?? null})
    ON CONFLICT DO NOTHING RETURNING id`;
  return r?.id ?? null;
}

/** Tolkar ett dokument. Utan API-nyckel blir det klart för manuell registrering. */
export async function processDocument(id: number) {
  const [d] = await sql<{ company_id: number; mime_type: string; data: Buffer | null; status: string }[]>`
    SELECT company_id, mime_type, data, status FROM inbox_documents WHERE id = ${id}`;
  if (!d || !d.data || !['new', 'failed'].includes(d.status)) return;
  // E-faktura (Peppol BIS/UBL): uppgifterna läses direkt ur XML-filen, ingen AI behövs
  if (d.mime_type === 'application/xml') {
    try {
      const x = parseUbl(Buffer.from(d.data).toString('utf8'));
      await sql`UPDATE inbox_documents SET status = 'ready', extracted = ${sql.json(x as never)}, error = '' WHERE id = ${id}`;
    } catch (e) {
      await sql`UPDATE inbox_documents SET status = 'failed', error = ${e instanceof Error ? e.message : 'E-fakturan kunde inte läsas'} WHERE id = ${id}`;
    }
    return;
  }
  if (!invoiceAiEnabled()) {
    await sql`UPDATE inbox_documents SET status = 'ready', error = '' WHERE id = ${id}`;
    return;
  }
  const accounts = await sql<{ number: number; name: string }[]>`SELECT number, name FROM accounts WHERE company_id = ${d.company_id} AND active AND number BETWEEN 4000 AND 7999 ORDER BY number`;
  try {
    const x = await extractInvoice({ mimeType: d.mime_type, data: Buffer.from(d.data) }, [...accounts]);
    await sql`UPDATE inbox_documents SET status = 'ready', extracted = ${sql.json(x as never)}, error = '' WHERE id = ${id}`;
  } catch (e) {
    const msg = e instanceof ExtractionError ? e.message : 'Tolkningen misslyckades';
    if (!(e instanceof ExtractionError)) console.error(e);
    await sql`UPDATE inbox_documents SET status = 'failed', error = ${msg} WHERE id = ${id}`;
  }
}

/** För cron: tolkar dokument som fastnat som nya (t.ex. om funktionen avbröts) */
export async function processPending(limit = 20) {
  const rows = await sql<{ id: number }[]>`SELECT id FROM inbox_documents WHERE status = 'new' AND created_at < now() - interval '2 minutes' ORDER BY id LIMIT ${limit}`;
  for (const r of rows) await processDocument(r.id);
  return rows.length;
}

/** Gallring: borttagna dokument raderas efter 90 dagar. Registrerade finns kvar som underlag på fakturan, så filen i inkorgen tas bort efter 30 dagar. */
export async function cleanupInbox() {
  const a = await sql`DELETE FROM inbox_documents WHERE status = 'rejected' AND handled_at < now() - interval '90 days'`;
  const b = await sql`UPDATE inbox_documents SET data = NULL WHERE status = 'registered' AND data IS NOT NULL AND handled_at < now() - interval '30 days'`;
  return { deleted: a.count, cleared: b.count };
}

// ---------- E-post via Resend ----------

const resendApi = () => (process.env.RESEND_API_URL || 'https://api.resend.com').replace(/\/$/, '');

interface ResendReceived {
  email_id: string; from?: string; to?: string[]; cc?: string[]; bcc?: string[]; received_for?: string[]; subject?: string;
  attachments?: { id: string; filename: string; content_type: string; content_disposition?: string }[];
}

/** Tar emot ett mejl (webhooken email.received) och sparar bilagorna i rätt bolags inkorg. Returnerar nya dokument-id. */
export async function receiveResendEmail(data: ResendReceived): Promise<number[]> {
  const domain = inboxDomain();
  if (!domain || !data?.email_id) return [];
  const tokens = tokensIn([...(data.to ?? []), ...(data.cc ?? []), ...(data.bcc ?? []), ...(data.received_for ?? [])], domain);
  if (!tokens.length) return [];
  const companies = await sql<{ id: number }[]>`SELECT id FROM companies WHERE inbox_token IN ${sql(tokens)}`;
  if (!companies.length) return [];
  const wanted = (data.attachments ?? []).filter((a) => !(a.content_disposition === 'inline' && a.content_type.startsWith('image/')));
  const files: { filename: string; mimeType: string; data: Buffer | null; error?: string }[] = [];
  if (wanted.length) {
    const res = await fetch(`${resendApi()}/emails/receiving/${encodeURIComponent(data.email_id)}/attachments`, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } });
    if (!res.ok) throw new Error(`Resend svarade ${res.status} på bilagor`);
    const list = (await res.json()) as { data: { id: string; filename: string; content_type: string; size?: number; download_url: string }[] };
    for (const a of list.data.filter((x) => wanted.some((w) => w.id === x.id))) {
      if ((a.size ?? 0) > INBOX_MAX_BYTES) { files.push({ filename: a.filename, mimeType: a.content_type, data: null, error: 'Filen är större än 10 MB' }); continue; }
      const f = await fetch(a.download_url);
      if (!f.ok) { files.push({ filename: a.filename, mimeType: a.content_type, data: null, error: 'Bilagan kunde inte hämtas' }); continue; }
      files.push({ filename: a.filename, mimeType: a.content_type, data: Buffer.from(await f.arrayBuffer()) });
    }
  }
  if (!files.length) files.push({ filename: '', mimeType: '', data: null, error: 'Mejlet saknade bilaga – be leverantören skicka fakturan som PDF' });
  const ids: number[] = [];
  for (const c of companies) {
    for (const f of files) {
      const id = await addDocument(c.id, { source: 'email', messageId: data.email_id, from: data.from, subject: data.subject, ...f });
      if (id) ids.push(id);
    }
  }
  return ids;
}

// ---------- Granskning ----------

export interface InboxRow {
  id: number; source: string; from_address: string; subject: string; filename: string; mime_type: string; status: string; error: string;
  extracted: Extracted | null; supplier_invoice_id: number | null; created_at: string; has_file: boolean;
}

export async function listInbox(companyId: number, opts: { open?: boolean } = {}) {
  return sql<InboxRow[]>`
    SELECT id, source, from_address, subject, filename, mime_type, status, error, extracted, supplier_invoice_id, to_char(created_at,'YYYY-MM-DD HH24:MI') AS created_at, data IS NOT NULL AS has_file
    FROM inbox_documents WHERE company_id = ${companyId} ${opts.open ? sql`AND status IN ('new','ready','failed')` : sql`AND status IN ('registered','rejected')`}
    ORDER BY created_at DESC LIMIT 200`;
}

export interface Suggestion { supplierId: number | null; account: number | null; duplicateOf: number | null }

/** Föreslår leverantör (org.nr, bankgiro, plusgiro eller namn), konto (senast använda för leverantören) och varnar för dubbletter */
export async function suggest(companyId: number, x: Extracted | null): Promise<Suggestion> {
  if (!x) return { supplierId: null, account: null, duplicateOf: null };
  const d = (s: string) => s.replace(/\D/g, '');
  const s = x.supplier;
  const [m] = await sql<{ id: number; default_account: number }[]>`
    SELECT id, default_account FROM suppliers WHERE company_id = ${companyId} AND (
      (${d(s.orgnr)} <> '' AND regexp_replace(orgnr, '\\D', '', 'g') = ${d(s.orgnr)})
      OR (${d(s.bankgiro)} <> '' AND regexp_replace(bankgiro, '\\D', '', 'g') = ${d(s.bankgiro)})
      OR (${d(s.plusgiro)} <> '' AND regexp_replace(plusgiro, '\\D', '', 'g') = ${d(s.plusgiro)})
      OR (${s.name} <> '' AND lower(name) = lower(${s.name})))
    ORDER BY (${d(s.orgnr)} <> '' AND regexp_replace(orgnr, '\\D', '', 'g') = ${d(s.orgnr)}) DESC, id LIMIT 1`;
  if (!m) return { supplierId: null, account: x.account, duplicateOf: null };
  // Leverantörens eget standardkonto om det är ändrat från 4010, annars det vanligaste kontot på de senaste fakturorna
  const [common] = await sql<{ account: number }[]>`
    SELECT (cost_lines->0->>'account')::int AS account FROM (SELECT cost_lines FROM supplier_invoices WHERE company_id = ${companyId} AND supplier_id = ${m.id} ORDER BY id DESC LIMIT 10) x
    GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1`;
  const [dup] = x.invoiceNumber ? await sql<{ id: number }[]>`
    SELECT id FROM supplier_invoices WHERE company_id = ${companyId} AND supplier_id = ${m.id} AND invoice_number = ${x.invoiceNumber}` : [];
  return { supplierId: m.id, account: (m.default_account !== 4010 ? m.default_account : null) ?? common?.account ?? x.account ?? m.default_account, duplicateOf: dup?.id ?? null };
}

export async function getInboxDoc(companyId: number, id: number) {
  const [d] = await sql<InboxRow[]>`
    SELECT id, source, from_address, subject, filename, mime_type, status, error, extracted, supplier_invoice_id, to_char(created_at,'YYYY-MM-DD HH24:MI') AS created_at, data IS NOT NULL AS has_file
    FROM inbox_documents WHERE id = ${id} AND company_id = ${companyId}`;
  if (!d) throw new NotFoundError('Dokumentet');
  return { doc: d, suggestion: await suggest(companyId, d.extracted) };
}

export async function inboxFile(companyId: number, id: number) {
  const [d] = await sql<{ filename: string; mime_type: string; data: Buffer | null }[]>`SELECT filename, mime_type, data FROM inbox_documents WHERE id = ${id} AND company_id = ${companyId}`;
  if (!d?.data) throw new NotFoundError('Filen');
  return d;
}

/** Registrerar dokumentet som leverantörsfaktura (och vid behov en ny leverantör). Belopp i öre. */
export async function registerFromInbox(actor: Actor, id: number, input: {
  supplier_id: string; new_supplier?: { name: string; orgnr: string; bankgiro: string; plusgiro: string; default_account: string };
  invoice_number: string; invoice_date: string; due_date: string; payment_reference: string; description: string; total: number | null; vat: number | null; account: string;
}) {
  const [d] = await sql<{ status: string; filename: string; mime_type: string; data: Buffer | null }[]>`
    SELECT status, filename, mime_type, data FROM inbox_documents WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!d) throw new NotFoundError('Dokumentet');
  if (d.status === 'registered') throw new ConflictError('Dokumentet är redan registrerat');
  if (!input.account) throw new ValidationError('Välj kostnadskonto');
  if (input.total == null) throw new ValidationError('Ange belopp att betala');
  const vat = input.vat ?? 0;
  let supplierId = Number(input.supplier_id);
  if (input.supplier_id === 'new') {
    if (!input.new_supplier?.name) throw new ValidationError('Ange leverantörens namn');
    supplierId = (await createSupplier(actor, { ...input.new_supplier, default_account: input.new_supplier.default_account || input.account })).id;
  }
  const si = await registerSupplierInvoice(actor, {
    supplier_id: supplierId, invoice_number: input.invoice_number, invoice_date: input.invoice_date, due_date: input.due_date,
    payment_reference: input.payment_reference, description: input.description, total: input.total, vat,
    lines: [{ account: input.account, amount: input.total - vat, description: input.description }],
  }, d.data ? { filename: d.filename || `faktura-${id}.pdf`, mimeType: d.mime_type, data: Buffer.from(d.data) } : null);
  await sql`UPDATE inbox_documents SET status = 'registered', supplier_invoice_id = ${si.id}, handled_at = now() WHERE id = ${id}`;
  await auditBy(sql, actor, 'register_from_inbox', 'supplier_invoice', si.id, { inbox_document: id });
  return si;
}

export async function rejectDocument(actor: Actor, id: number) {
  const r = await sql`UPDATE inbox_documents SET status = 'rejected', handled_at = now() WHERE id = ${id} AND company_id = ${actor.companyId} AND status <> 'registered'`;
  if (!r.count) throw new NotFoundError('Dokumentet');
  await auditBy(sql, actor, 'reject', 'inbox_document', id);
}

export async function reopenDocument(actor: Actor, id: number) {
  await sql`UPDATE inbox_documents SET status = CASE WHEN extracted IS NULL AND data IS NOT NULL THEN 'new' ELSE 'ready' END, handled_at = NULL
    WHERE id = ${id} AND company_id = ${actor.companyId} AND status = 'rejected'`;
}

export async function retryDocument(actor: Actor, id: number) {
  const r = await sql`UPDATE inbox_documents SET status = 'new', error = '' WHERE id = ${id} AND company_id = ${actor.companyId} AND status IN ('ready','failed') AND data IS NOT NULL`;
  if (!r.count) throw new NotFoundError('Dokumentet');
  await processDocument(id);
}
