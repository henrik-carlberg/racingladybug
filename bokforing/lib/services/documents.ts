import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { emit } from '@/lib/server/events';
import { decrypt, encrypt, seal } from '@/lib/server/crypto';
import { sendMail } from '@/lib/server/mail';
import { sha256 as sha256hex, verifyPassword, type User } from '@/lib/server/auth';
import type { Actor } from './actor';
import { arr, list, optInt, str, type Page } from './input';

// E-signering: enkel elektronisk underskrift med stark spårbarhet.
//  - Interna undertecknare (användare i appen) signerar inloggade med passkey (biometri/PIN) eller lösenord.
//  - Externa undertecknare signerar via personlig länk och bekräftar genom att skriva sitt namn.
// Dokumentets innehåll hashas (SHA-256) när det skickas; varje signatur binds till hashen. När alla signerat
// förseglas beviset med HMAC så att ändringar i efterhand kan upptäckas.

export interface SignerOut {
  id: number; name: string; email: string; user_id: number | null; type: 'internal' | 'external'; status: 'pending' | 'signed' | 'declined';
  method: string | null; signed_name: string | null; signed_at: string | null; ip: string | null; decline_reason: string | null;
  signing_url?: string | null;
}
export interface DocumentOut {
  id: number; object: 'document'; title: string; kind: 'html' | 'pdf'; filename: string | null; sha256: string; status: string;
  message: string; source_module: string | null; source_id: number | null; created_by: string; created_at: string; completed_at: string | null;
  seal_valid: boolean | null; signers: SignerOut[]; events?: { event: string; signer: string | null; at: string; ip: string | null }[];
}

const appOrigin = () => process.env.APP_ORIGIN ?? '';
export const signingUrl = (origin: string, token: string) => `${origin}/sign/${token}`;

export function hashContent(kind: 'html' | 'pdf', title: string, content: string | Buffer): string {
  return createHash('sha256').update(kind).update('\0').update(title).update('\0').update(content).digest('hex');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Vanlig text → enkel HTML (stycken) */
export function textToHtml(text: string): string {
  return text.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n');
}

async function event(db: Tx | typeof sql, documentId: number, ev: string, o: { signerId?: number | null; details?: unknown; ip?: string | null; ua?: string | null } = {}) {
  await db`INSERT INTO document_events (document_id, signer_id, event, details, ip, user_agent)
    VALUES (${documentId}, ${o.signerId ?? null}, ${ev}, ${o.details == null ? null : db.json(o.details as never)}, ${o.ip ?? null}, ${o.ua ?? null})`;
}

/** Kanoniskt signeringsbevis som förseglas */
function evidenceRecord(d: { id: number; sha256: string }, signers: { id: number; name: string; email: string; method: string | null; signed_name: string | null; signed_at: string | null; ip: string | null; evidence: unknown }[]) {
  return JSON.stringify({
    document_id: d.id, sha256: d.sha256,
    signers: signers.map((s) => ({ id: s.id, name: s.name, email: s.email, method: s.method, signed_name: s.signed_name, signed_at: s.signed_at, ip: s.ip,
      evidence_sha256: createHash('sha256').update(JSON.stringify(s.evidence ?? null)).digest('hex') })),
  });
}

async function loadSignersForSeal(db: Tx | typeof sql, documentId: number) {
  return db<{ id: number; name: string; email: string; method: string | null; signed_name: string | null; signed_at: string | null; ip: string | null; evidence: unknown }[]>`
    SELECT id, name, email, method, signed_name, to_char(signed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS signed_at, ip, evidence
    FROM document_signers WHERE document_id = ${documentId} ORDER BY position`;
}

async function fetchDocument(db: Tx | typeof sql, companyId: number, id: number, origin = appOrigin()): Promise<DocumentOut> {
  const [d] = await db<(Omit<DocumentOut, 'signers' | 'object' | 'seal_valid'> & { seal: string | null })[]>`
    SELECT d.id, d.title, d.kind, d.filename, d.sha256, d.status, d.message, d.source_module, d.source_id, u.name AS created_by,
      d.created_at, d.completed_at, d.seal
    FROM documents d JOIN users u ON u.id = d.created_by WHERE d.id = ${id} AND d.company_id = ${companyId}`;
  if (!d) throw new NotFoundError('Dokumentet');
  const signers = await db<(SignerOut & { token_enc: string | null })[]>`
    SELECT id, name, email, user_id, CASE WHEN user_id IS NULL THEN 'external' ELSE 'internal' END AS type, status, method, signed_name,
      to_char(signed_at AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD HH24:MI:SS') AS signed_at, ip, decline_reason, token_enc
    FROM document_signers WHERE document_id = ${id} ORDER BY position`;
  const events = await db<{ event: string; signer: string | null; at: string; ip: string | null }[]>`
    SELECT e.event, s.name AS signer, to_char(e.created_at AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD HH24:MI:SS') AS at, e.ip
    FROM document_events e LEFT JOIN document_signers s ON s.id = e.signer_id WHERE e.document_id = ${id} ORDER BY e.id`;
  let sealValid: boolean | null = null;
  if (d.seal) sealValid = seal(evidenceRecord(d, await loadSignersForSeal(db, id))) === d.seal;
  const { seal: storedSeal, ...rest } = d;
  void storedSeal;
  return {
    ...rest, object: 'document', seal_valid: sealValid, events: [...events],
    signers: signers.map(({ token_enc, ...s }) => ({
      ...s, signing_url: token_enc && s.status === 'pending' && d.status === 'pending' && origin ? signingUrl(origin, decrypt(token_enc)) : null,
    })),
  };
}

export const getDocument = (companyId: number, id: number, origin?: string) => fetchDocument(sql, companyId, id, origin);

export async function listDocuments(companyId: number, p: Page, f: { status?: string; source_module?: string } = {}) {
  const rows = await sql<{ id: number }[]>`SELECT id FROM documents WHERE company_id = ${companyId}
    ${f.status ? sql`AND status = ${f.status}` : sql``} ${f.source_module ? sql`AND source_module = ${f.source_module}` : sql``}
    ${p.startingAfter ? sql`AND id < ${p.startingAfter}` : sql``} ORDER BY id DESC LIMIT ${p.limit + 1}`;
  const res = list([...rows], p);
  return { ...res, data: await Promise.all(res.data.map((r) => getDocument(companyId, r.id))) };
}

export async function createDocument(actor: Actor, input: Record<string, unknown>, db?: Tx): Promise<DocumentOut> {
  const title = str(input, 'title', { required: true, label: 'Titel', max: 300 });
  const html = str(input, 'html', { max: 2_000_000 });
  const pdfB64 = str(input, 'pdf_base64', { max: 15_000_000 });
  if (!html && !pdfB64) throw new ValidationError('Ange dokumentets innehåll (html eller pdf_base64)');
  const pdf = pdfB64 ? Buffer.from(pdfB64, 'base64') : null;
  if (pdf && pdf.subarray(0, 5).toString() !== '%PDF-') throw new ValidationError('Filen är inte en PDF');
  const signers = arr(input, 'signers', 'Undertecknare').map((s, i) => {
    const userId = optInt(s, 'user_id', 'Användare');
    const email = str(s, 'email');
    if (!userId && email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ValidationError(`Undertecknare ${i + 1}: ogiltig e-post`);
    return { name: str(s, 'name', { required: true, label: `Undertecknare ${i + 1}: namn` }), email, userId };
  });
  if (signers.length === 0 || signers.length > 20) throw new ValidationError('Ange 1–20 undertecknare');
  const run = async (tx: Tx) => {
    for (const s of signers) {
      if (!s.userId) continue;
      const [m] = await tx<{ email: string }[]>`SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.user_id = ${s.userId} AND m.company_id = ${actor.companyId}`;
      if (!m) throw new ValidationError(`Användare ${s.userId} tillhör inte bolaget`);
      s.email ||= m.email;
    }
    const kind = pdf ? 'pdf' : 'html';
    const [d] = await tx<{ id: number }[]>`INSERT INTO documents ${tx({
      company_id: actor.companyId, title, kind, html: pdf ? null : html, file: pdf, filename: pdf ? (str(input, 'filename') || `${title}.pdf`) : null,
      sha256: hashContent(kind, title, pdf ?? html), message: str(input, 'message', { max: 5000 }),
      source_module: str(input, 'source_module') || null, source_id: optInt(input, 'source_id'), created_by: actor.userId,
    })} RETURNING id`;
    await tx`INSERT INTO document_signers ${tx(signers.map((s, i) => ({ document_id: d.id, position: i + 1, name: s.name, email: s.email, user_id: s.userId })))}`;
    await event(tx, d.id, 'created');
    await auditBy(tx, actor, 'create', 'document', d.id, { title });
    return fetchDocument(tx, actor.companyId, d.id);
  };
  return db ? run(db) : sql.begin(run);
}

/** Skickar dokumentet: låser innehållet och skapar personliga länkar för externa undertecknare */
export async function sendDocument(actor: Actor, id: number, origin = appOrigin(), db?: Tx): Promise<DocumentOut> {
  const mails: { to: string; name: string; url: string; title: string; message: string }[] = [];
  const run = async (tx: Tx) => {
    const [d] = await tx<{ status: string; title: string; message: string }[]>`SELECT status, title, message FROM documents WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!d) throw new NotFoundError('Dokumentet');
    if (d.status !== 'draft') throw new ConflictError('Dokumentet är redan skickat');
    const signers = await tx<{ id: number; name: string; email: string; user_id: number | null }[]>`SELECT id, name, email, user_id FROM document_signers WHERE document_id = ${id}`;
    for (const s of signers) {
      if (s.user_id) continue;
      const token = randomBytes(24).toString('base64url');
      await tx`UPDATE document_signers SET token_hash = ${sha256hex(token)}, token_enc = ${encrypt(token)} WHERE id = ${s.id}`;
      if (s.email && origin) mails.push({ to: s.email, name: s.name, url: signingUrl(origin, token), title: d.title, message: d.message });
    }
    await tx`UPDATE documents SET status = 'pending' WHERE id = ${id}`;
    await event(tx, id, 'sent');
    await auditBy(tx, actor, 'send', 'document', id);
    const out = await fetchDocument(tx, actor.companyId, id, origin);
    await emit(tx, actor.companyId, 'document.sent', { ...out, signers: out.signers.map(({ signing_url: _u, ...s }) => s) });
    return out;
  };
  const out = await (db ? run(db) : sql.begin(run));
  for (const m of mails) {
    await sendMail(m.to, `Signera: ${m.title}`, `Hej ${m.name}!\n\nDu har fått ett dokument att granska och signera: ${m.title}\n${m.message ? `\n${m.message}\n` : ''}\nÖppna dokumentet här:\n${m.url}\n`);
  }
  return out;
}

export async function cancelDocument(actor: Actor, id: number) {
  return sql.begin(async (tx) => {
    const r = await tx`UPDATE documents SET status = 'cancelled' WHERE id = ${id} AND company_id = ${actor.companyId} AND status IN ('draft','pending') RETURNING id`;
    if (!r.length) throw new ConflictError('Endast dokument som inte är klara kan återkallas');
    await event(tx, id, 'cancelled');
    await auditBy(tx, actor, 'cancel', 'document', id);
    const out = await fetchDocument(tx, actor.companyId, id);
    await emit(tx, actor.companyId, 'document.cancelled', out);
    return out;
  });
}

// ---------- Signering ----------

interface SignCtx { ip: string | null; ua: string | null }

async function markSigned(tx: Tx, signerId: number, documentId: number, companyId: number, data: { method: string; signedName: string; evidence: unknown }, c: SignCtx) {
  await tx`UPDATE document_signers SET status = 'signed', method = ${data.method}, signed_name = ${data.signedName}, signed_at = now(),
    ip = ${c.ip}, user_agent = ${c.ua}, evidence = ${tx.json(data.evidence as never)} WHERE id = ${signerId}`;
  await event(tx, documentId, 'signed', { signerId, details: { method: data.method }, ip: c.ip, ua: c.ua });
  const doc = await fetchDocument(tx, companyId, documentId);
  const signer = doc.signers.find((s) => s.id === signerId)!;
  await emit(tx, companyId, 'document.signed', { document_id: documentId, title: doc.title, source_module: doc.source_module, source_id: doc.source_id,
    signer: { id: signer.id, name: signer.name, email: signer.email, method: signer.method } });
  if (doc.signers.every((s) => s.status === 'signed')) {
    const [d] = await tx<{ id: number; sha256: string }[]>`SELECT id, sha256 FROM documents WHERE id = ${documentId}`;
    const sealed = seal(evidenceRecord(d, await loadSignersForSeal(tx, documentId)));
    await tx`UPDATE documents SET status = 'completed', completed_at = now(), seal = ${sealed} WHERE id = ${documentId}`;
    await event(tx, documentId, 'completed');
    const done = await fetchDocument(tx, companyId, documentId);
    await emit(tx, companyId, 'document.completed', { ...done, signers: done.signers.map(({ signing_url: _u, ...s }) => s) });
  }
}

async function pendingSigner(tx: Tx, where: { token?: string; signerId?: number; userId?: number }) {
  const [s] = await tx<{ id: number; name: string; user_id: number | null; status: string; document_id: number; company_id: number; doc_status: string; sha256: string }[]>`
    SELECT s.id, s.name, s.user_id, s.status, s.document_id, d.company_id, d.status AS doc_status, d.sha256
    FROM document_signers s JOIN documents d ON d.id = s.document_id
    WHERE ${where.token ? tx`s.token_hash = ${sha256hex(where.token)}` : tx`s.id = ${where.signerId!} AND s.user_id = ${where.userId!}`}
    FOR UPDATE OF s`;
  if (!s) throw new NotFoundError('Signeringen');
  if (s.doc_status === 'cancelled') throw new ConflictError('Dokumentet har återkallats');
  if (s.doc_status !== 'pending') throw new ConflictError('Dokumentet går inte längre att signera');
  if (s.status !== 'pending') throw new ConflictError(s.status === 'signed' ? 'Du har redan signerat' : 'Du har avböjt att signera');
  return s;
}

const normName = (s: string) => s.toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim();

/** Extern undertecknare via länk */
export async function getSigningView(token: string, c: SignCtx) {
  const [s] = await sql<{ id: number; name: string; status: string; signed_at: string | null; document_id: number; title: string; kind: string; html: string | null;
    filename: string | null; sha256: string; message: string; doc_status: string; company: string; orgnr: string }[]>`
    SELECT s.id, s.name, s.status, to_char(s.signed_at AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD HH24:MI') AS signed_at, d.id AS document_id, d.title, d.kind, d.html,
      d.filename, d.sha256, d.message, d.status AS doc_status, c.name AS company, c.orgnr
    FROM document_signers s JOIN documents d ON d.id = s.document_id JOIN companies c ON c.id = d.company_id
    WHERE s.token_hash = ${sha256hex(token)}`;
  if (!s) return null;
  if (s.status === 'pending' && s.doc_status === 'pending') {
    const seen = await sql`SELECT 1 FROM document_events WHERE signer_id = ${s.id} AND event = 'viewed'`;
    if (!seen.length) await event(sql, s.document_id, 'viewed', { signerId: s.id, ip: c.ip, ua: c.ua });
  }
  return s;
}

export async function signWithLink(token: string, input: { signed_name: string; consent: boolean }, c: SignCtx) {
  await sql.begin(async (tx) => {
    const s = await pendingSigner(tx, { token });
    if (!input.consent) throw new ValidationError('Bekräfta att du har läst och godkänner dokumentet');
    if (normName(input.signed_name) !== normName(s.name)) throw new ValidationError(`Skriv ditt fullständiga namn exakt som det står i dokumentet: ${s.name}`);
    await markSigned(tx, s.id, s.document_id, s.company_id, {
      method: 'link', signedName: input.signed_name.trim(),
      evidence: { method: 'link', document_sha256: s.sha256, typed_name: input.signed_name.trim(), consent: true, ip: c.ip, user_agent: c.ua, at: new Date().toISOString() },
    }, c);
  });
}

export async function declineWithLink(token: string, reason: string, c: SignCtx) {
  await sql.begin(async (tx) => {
    const s = await pendingSigner(tx, { token });
    await decline(tx, s, reason, c);
  });
}

async function decline(tx: Tx, s: { id: number; document_id: number; company_id: number }, reason: string, c: SignCtx) {
  await tx`UPDATE document_signers SET status = 'declined', decline_reason = ${reason.slice(0, 1000)}, signed_at = now(), ip = ${c.ip}, user_agent = ${c.ua} WHERE id = ${s.id}`;
  await tx`UPDATE documents SET status = 'declined' WHERE id = ${s.document_id}`;
  await event(tx, s.document_id, 'declined', { signerId: s.id, details: { reason }, ip: c.ip, ua: c.ua });
  const doc = await fetchDocument(tx, s.company_id, s.document_id);
  await emit(tx, s.company_id, 'document.declined', { ...doc, signers: doc.signers.map(({ signing_url: _u, ...x }) => x) });
}

/** Intern undertecknare (inloggad): signerar med lösenord. Passkey-varianten finns i signAsUserWithPasskey. */
export async function signAsUserWithPassword(user: User, signerId: number, password: string, c: SignCtx) {
  const [u] = await sql<{ password_hash: string }[]>`SELECT password_hash FROM users WHERE id = ${user.id}`;
  if (!(await verifyPassword(password, u.password_hash))) throw new ForbiddenError('Fel lösenord');
  await sql.begin(async (tx) => {
    const s = await pendingSigner(tx, { signerId, userId: user.id });
    await markSigned(tx, s.id, s.document_id, s.company_id, {
      method: 'password', signedName: user.name,
      evidence: { method: 'password', document_sha256: s.sha256, user_id: user.id, email: user.email, ip: c.ip, user_agent: c.ua, at: new Date().toISOString() },
    }, c);
  });
}

export async function signAsUserWithPasskey(user: User, signerId: number, passkeyEvidence: Record<string, unknown>, c: SignCtx) {
  await sql.begin(async (tx) => {
    const s = await pendingSigner(tx, { signerId, userId: user.id });
    await markSigned(tx, s.id, s.document_id, s.company_id, {
      method: 'passkey', signedName: user.name,
      evidence: { method: 'passkey', document_sha256: s.sha256, user_id: user.id, email: user.email, ip: c.ip, user_agent: c.ua, at: new Date().toISOString(), webauthn: passkeyEvidence },
    }, c);
  });
}

export async function declineAsUser(user: User, signerId: number, reason: string, c: SignCtx) {
  await sql.begin(async (tx) => {
    const s = await pendingSigner(tx, { signerId, userId: user.id });
    await decline(tx, s, reason, c);
  });
}

/** Dokumenthash för en intern undertecknares signering (för att binda passkey-challengen) */
export async function signerDocumentHash(userId: number, signerId: number): Promise<string> {
  const [s] = await sql<{ sha256: string }[]>`SELECT d.sha256 FROM document_signers s JOIN documents d ON d.id = s.document_id
    WHERE s.id = ${signerId} AND s.user_id = ${userId} AND s.status = 'pending' AND d.status = 'pending'`;
  if (!s) throw new NotFoundError('Signeringen');
  return s.sha256;
}
