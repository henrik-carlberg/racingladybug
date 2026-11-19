import 'server-only';
import { insertAttachment, type AttachmentIn } from './vouchers';
import { randomBytes } from 'node:crypto';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { audit, auditBy } from '@/lib/server/audit';
import { newToken, sha256 } from '@/lib/server/auth';
import { enabledModules } from '@/lib/modules/enabled';
import { companyDeadlines } from './deadlines';
import { companyTodos, urgentCount } from './todo';
import type { Actor } from './actor';

export interface Firm { id: number; name: string; orgnr: string; code: string; role: 'owner' | 'member' }

const newCode = () => randomBytes(6).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, '').padEnd(8, 'X').slice(0, 8);

export async function myFirms(userId: number): Promise<Firm[]> {
  return [...await sql<Firm[]>`SELECT f.id, f.name, f.orgnr, f.code, m.role FROM firms f JOIN firm_members m ON m.firm_id = f.id WHERE m.user_id = ${userId} ORDER BY f.name`];
}

export async function requireFirm(userId: number, firmId: number, owner = false): Promise<Firm> {
  const f = (await myFirms(userId)).find((x) => x.id === firmId);
  if (!f) throw new NotFoundError('Byrån');
  if (owner && f.role !== 'owner') throw new ValidationError('Endast byråns ägare får göra detta');
  return f;
}

export async function createFirm(userId: number, name: string, orgnr: string) {
  if (!name.trim()) throw new ValidationError('Ange byråns namn');
  return sql.begin(async (tx) => {
    const [f] = await tx<{ id: number }[]>`INSERT INTO firms (name, orgnr, code, created_by) VALUES (${name.trim()}, ${orgnr.trim()}, ${newCode()}, ${userId}) RETURNING id`;
    await tx`INSERT INTO firm_members (firm_id, user_id, role) VALUES (${f.id}, ${userId}, 'owner')`;
    await audit(tx, { companyId: null, userId, action: 'create_firm', entity: 'firm', entityId: f.id });
    return f.id;
  });
}

export async function newFirmCode(userId: number, firmId: number) {
  await requireFirm(userId, firmId, true);
  await sql`UPDATE firms SET code = ${newCode()} WHERE id = ${firmId}`;
}

// ---------- Kollegor ----------

export async function inviteColleague(userId: number, firmId: number, email: string) {
  await requireFirm(userId, firmId, true);
  const e = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new ValidationError('Ogiltig e-postadress');
  const token = newToken();
  await sql`INSERT INTO firm_invites (firm_id, email, token_hash, expires_at, created_by) VALUES (${firmId}, ${e}, ${sha256(token)}, now() + interval '14 days', ${userId})`;
  return token;
}

export async function acceptFirmInvite(userId: number, email: string, token: string) {
  return sql.begin(async (tx) => {
    const [inv] = await tx<{ id: number; firm_id: number; email: string }[]>`
      SELECT id, firm_id, email FROM firm_invites WHERE token_hash = ${sha256(token)} AND accepted_at IS NULL AND expires_at > now() FOR UPDATE`;
    if (!inv) throw new ValidationError('Inbjudan är ogiltig eller har gått ut');
    if (inv.email !== email.toLowerCase()) throw new ValidationError(`Inbjudan gäller ${inv.email}. Logga in med den adressen.`);
    await tx`INSERT INTO firm_members (firm_id, user_id) VALUES (${inv.firm_id}, ${userId}) ON CONFLICT DO NOTHING`;
    await tx`UPDATE firm_invites SET accepted_at = now() WHERE id = ${inv.id}`;
    await audit(tx, { companyId: null, userId, action: 'join_firm', entity: 'firm', entityId: inv.firm_id });
    return inv.firm_id;
  });
}

export async function firmMembers(firmId: number) {
  return sql<{ user_id: number; name: string; email: string; role: string }[]>`
    SELECT u.id AS user_id, u.name, u.email, m.role FROM firm_members m JOIN users u ON u.id = m.user_id WHERE m.firm_id = ${firmId} ORDER BY m.role DESC, u.name`;
}

export async function removeMember(userId: number, firmId: number, memberId: number) {
  await requireFirm(userId, firmId, true);
  if (memberId === userId) throw new ValidationError('Du kan inte ta bort dig själv');
  await sql`DELETE FROM firm_members WHERE firm_id = ${firmId} AND user_id = ${memberId} AND role <> 'owner'`;
}

// ---------- Klienter (bolagets sida) ----------

/** Bolagets ägare ger en byrå åtkomst med byråns kod. Byråns konsulter får rollen redovisningskonsult. */
export async function grantFirm(actor: Actor, code: string) {
  const [f] = await sql<{ id: number; name: string }[]>`SELECT id, name FROM firms WHERE code = ${code.trim().toUpperCase()}`;
  if (!f) throw new ValidationError('Hittar ingen byrå med den koden');
  const r = await sql`INSERT INTO firm_clients (firm_id, company_id, granted_by) VALUES (${f.id}, ${actor.companyId}, ${actor.userId}) ON CONFLICT DO NOTHING`;
  if (!r.count) throw new ConflictError(`${f.name} har redan åtkomst`);
  await auditBy(sql, actor, 'grant_firm', 'firm', f.id, { firm: f.name });
  return f.name;
}

export async function revokeFirm(actor: Actor, firmId: number) {
  const r = await sql`DELETE FROM firm_clients WHERE firm_id = ${firmId} AND company_id = ${actor.companyId}`;
  if (!r.count) throw new NotFoundError('Byrån');
  await auditBy(sql, actor, 'revoke_firm', 'firm', firmId);
}

export async function companyFirms(companyId: number) {
  return sql<{ id: number; name: string; orgnr: string; since: string; members: number }[]>`
    SELECT f.id, f.name, f.orgnr, to_char(fc.created_at,'YYYY-MM-DD') AS since, (SELECT count(*)::int FROM firm_members m WHERE m.firm_id = f.id) AS members
    FROM firm_clients fc JOIN firms f ON f.id = fc.firm_id WHERE fc.company_id = ${companyId} ORDER BY f.name`;
}

// ---------- Byråns översikt ----------

export interface ClientRow {
  id: number; name: string; orgnr: string; responsible: number | null; responsible_name: string | null;
  urgent: number; bank: number; inbox: number; openQuestions: number; answered: number;
  nextDeadline: { title: string; due: string; status: string } | null; overdue: number; lastVoucher: string | null; vatPeriod: string;
}

export async function firmClients(firmId: number, userId: number): Promise<ClientRow[]> {
  const rows = await sql<{ id: number; name: string; orgnr: string; responsible: number | null; responsible_name: string | null; vat_period: string; last_voucher: string | null;
    bank: number; inbox: number; open_q: number; answered: number }[]>`
    SELECT c.id, c.name, c.orgnr, fc.responsible, u.name AS responsible_name, c.vat_period,
      (SELECT to_char(max(v.date),'YYYY-MM-DD') FROM vouchers v WHERE v.company_id = c.id) AS last_voucher,
      (SELECT count(*)::int FROM bank_transactions t WHERE t.company_id = c.id AND t.status = 'unmatched') AS bank,
      (SELECT count(*)::int FROM inbox_documents d WHERE d.company_id = c.id AND d.status IN ('new','ready','failed')) AS inbox,
      (SELECT count(*)::int FROM client_questions q WHERE q.company_id = c.id AND q.firm_id = ${firmId} AND q.status = 'open') AS open_q,
      (SELECT count(*)::int FROM client_questions q WHERE q.company_id = c.id AND q.firm_id = ${firmId} AND q.status = 'answered') AS answered
    FROM firm_clients fc JOIN companies c ON c.id = fc.company_id LEFT JOIN users u ON u.id = fc.responsible
    WHERE fc.firm_id = ${firmId} ORDER BY c.name`;
  const out: ClientRow[] = [];
  for (const r of rows) {
    const [todos, deadlines] = await Promise.all([
      companyTodos(r.id, { modules: (await enabledModules(r.id)).map((m) => m.id), owner: false, userId }),
      companyDeadlines(r.id),
    ]);
    const open = deadlines.filter((d) => d.status !== 'done');
    const next = open.sort((a, b) => a.due.localeCompare(b.due))[0];
    out.push({
      id: r.id, name: r.name, orgnr: r.orgnr, responsible: r.responsible, responsible_name: r.responsible_name, vatPeriod: r.vat_period,
      urgent: urgentCount(todos), bank: r.bank, inbox: r.inbox, openQuestions: r.open_q, answered: r.answered, lastVoucher: r.last_voucher,
      nextDeadline: next ? { title: next.title, due: next.due, status: next.status } : null, overdue: open.filter((d) => d.status === 'overdue').length,
    });
  }
  return out;
}

export async function setResponsible(userId: number, firmId: number, companyId: number, responsible: number | null) {
  await requireFirm(userId, firmId);
  if (responsible && !(await sql`SELECT 1 FROM firm_members WHERE firm_id = ${firmId} AND user_id = ${responsible}`).length) throw new ValidationError('Personen är inte med i byrån');
  await sql`UPDATE firm_clients SET responsible = ${responsible} WHERE firm_id = ${firmId} AND company_id = ${companyId}`;
}

// ---------- Frågor till kunden ----------

export interface Question {
  id: number; firm: string | null; entity: string | null; entity_id: number | null; question: string; answer: string; status: string;
  asked_by: string | null; answered_by: string | null; created_at: string; answered_at: string | null; context: string;
  needs_document: boolean; attachment_id: number | null;
}

/** Byråns konsult (eller vem som helst i bolaget) ställer en fråga, valfritt kopplad till en transaktion eller verifikation */
export async function askQuestion(actor: Actor, input: { question: string; entity?: string; entity_id?: number; needs_document?: boolean }) {
  const q = input.question.trim();
  if (!q) throw new ValidationError('Skriv en fråga');
  if (input.entity && !['bank_transaction', 'voucher', 'supplier_invoice', 'invoice'].includes(input.entity)) throw new ValidationError('Ogiltig koppling');
  if (input.entity && input.entity_id) {
    const { entityInfo } = await import('./comments');
    await entityInfo(actor.companyId, input.entity as never, input.entity_id);
  }
  const [firm] = await sql<{ firm_id: number }[]>`
    SELECT fc.firm_id FROM firm_clients fc JOIN firm_members fm ON fm.firm_id = fc.firm_id WHERE fc.company_id = ${actor.companyId} AND fm.user_id = ${actor.userId} LIMIT 1`;
  const [r] = await sql<{ id: number }[]>`
    INSERT INTO client_questions (company_id, firm_id, entity, entity_id, question, asked_by, needs_document)
    VALUES (${actor.companyId}, ${firm?.firm_id ?? null}, ${input.entity ?? null}, ${input.entity_id ?? null}, ${q.slice(0, 2000)}, ${actor.userId}, ${!!input.needs_document}) RETURNING id`;
  await auditBy(sql, actor, 'ask_question', 'client_question', r.id);
  return r.id;
}

export async function answerQuestion(actor: Actor, id: number, answer: string, file?: AttachmentIn | null) {
  const [q] = await sql<{ needs_document: boolean; entity: string | null; entity_id: number | null }[]>`
    SELECT needs_document, entity, entity_id FROM client_questions WHERE id = ${id} AND company_id = ${actor.companyId} AND status <> 'closed'`;
  if (!q) throw new NotFoundError('Frågan');
  if (!answer.trim() && !file) throw new ValidationError(q.needs_document ? 'Ladda upp underlaget eller skriv varför det saknas' : 'Skriv ett svar');
  if (file && !/^(image\/(jpeg|png|webp|gif|heic)|application\/pdf)$/.test(file.mimeType)) throw new ValidationError('Underlaget ska vara en bild eller PDF');
  await sql.begin(async (tx) => {
    await tx`UPDATE client_questions SET answer = ${answer.trim().slice(0, 4000) || (file ? 'Underlag bifogat' : '')}, status = 'answered', answered_by = ${actor.userId}, answered_at = now() WHERE id = ${id}`;
    if (file) {
      // Underlaget hamnar på verifikationen direkt om det finns en; annars kopplas det dit när transaktionen bokförs
      const [v] = q.entity === 'voucher' ? await tx<{ voucher_id: number }[]>`SELECT id AS voucher_id FROM vouchers WHERE id = ${q.entity_id} AND company_id = ${actor.companyId}`
        : q.entity === 'bank_transaction' ? await tx<{ voucher_id: number | null }[]>`SELECT voucher_id FROM bank_transactions WHERE id = ${q.entity_id} AND company_id = ${actor.companyId}`
        : [{ voucher_id: null }];
      const aid = await insertAttachment(tx, actor, v?.voucher_id ?? null, file);
      await tx`UPDATE attachments SET question_id = ${id} WHERE id = ${aid}`;
    }
    await auditBy(tx, actor, 'answer_question', 'client_question', id);
  });
}

export async function closeQuestion(actor: Actor, id: number) {
  const r = await sql`UPDATE client_questions SET status = 'closed' WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!r.count) throw new NotFoundError('Frågan');
}

export async function listQuestions(companyId: number, status?: string[]): Promise<Question[]> {
  return [...await sql<Question[]>`
    SELECT q.id, f.name AS firm, q.entity, q.entity_id, q.question, q.answer, q.status, a.name AS asked_by, b.name AS answered_by, q.needs_document,
      (SELECT max(id) FROM attachments WHERE question_id = q.id) AS attachment_id,
      to_char(q.created_at,'YYYY-MM-DD') AS created_at, to_char(q.answered_at,'YYYY-MM-DD') AS answered_at,
      COALESCE((SELECT to_char(t.booking_date,'YYYY-MM-DD') || ' · ' || COALESCE(NULLIF(t.counterparty,''), t.description) || ' · ' || to_char(t.amount / 100.0, 'FM999G999G990D00') || ' kr'
        FROM bank_transactions t WHERE q.entity = 'bank_transaction' AND t.id = q.entity_id AND t.company_id = q.company_id),
        (SELECT v.series || v.number || ' · ' || v.description FROM vouchers v WHERE q.entity = 'voucher' AND v.id = q.entity_id AND v.company_id = q.company_id), '') AS context
    FROM client_questions q LEFT JOIN firms f ON f.id = q.firm_id LEFT JOIN users a ON a.id = q.asked_by LEFT JOIN users b ON b.id = q.answered_by
    WHERE q.company_id = ${companyId} ${status ? sql`AND q.status IN ${sql(status)}` : sql``} ORDER BY q.created_at DESC LIMIT 200`];
}
