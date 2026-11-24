import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { decrypt, encrypt } from '@/lib/server/crypto';
import { CATEGORIES, RETENTION_YEARS, THRESHOLD, caseCode, deadlines, normalizeCode, type Category } from '@/lib/whistleblowing';
import type { Actor } from './actor';
import { str } from './input';

const hashCode = (code: string) => createHash('sha256').update(`whistle:${normalizeCode(code)}`).digest('hex');
const ownerOnly = (a: Actor) => { if (a.role !== 'owner') throw new ValidationError('Bara ägaren kan ändra inställningarna för visselblåsarkanalen'); };

export async function isHandler(companyId: number, userId: number) {
  // Handläggaren måste också vara medlem i bolaget (en borttagen medlem behåller aldrig åtkomsten)
  const [h] = await sql`SELECT 1 FROM whistle_handlers h JOIN memberships m ON m.company_id = h.company_id AND m.user_id = h.user_id WHERE h.company_id = ${companyId} AND h.user_id = ${userId}`;
  return !!h;
}
const requireHandler = async (actor: Actor) => { if (!(await isHandler(actor.companyId, actor.userId))) throw new ValidationError('Bara utsedda handläggare har åtkomst till rapporterna'); };

/** Gallring: avslutade ärenden raderas två år efter avslutet */
async function purge(companyId: number) {
  await sql`DELETE FROM whistle_reports WHERE company_id = ${companyId} AND status = 'closed' AND closed_at < now() - make_interval(years => ${RETENTION_YEARS})`;
}

export async function overview(actor: Actor) {
  await purge(actor.companyId);
  const [s] = await sql<{ token: string; active: boolean }[]>`SELECT token, active FROM whistle_settings WHERE company_id = ${actor.companyId}`;
  const [{ employees }] = await sql<{ employees: number }[]>`SELECT count(*)::int AS employees FROM employees WHERE company_id = ${actor.companyId} AND active`;
  const handlers = await sql<{ user_id: number; name: string; member: boolean }[]>`SELECT h.user_id, u.name, EXISTS (SELECT 1 FROM memberships m WHERE m.company_id = h.company_id AND m.user_id = h.user_id) AS member
    FROM whistle_handlers h JOIN users u ON u.id = h.user_id WHERE h.company_id = ${actor.companyId} ORDER BY u.name`;
  const members = actor.role === 'owner' ? await sql<{ id: number; name: string }[]>`SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.company_id = ${actor.companyId} ORDER BY u.name` : [];
  const handler = handlers.some((h) => h.user_id === actor.userId && h.member);
  const [{ open }] = await sql<{ open: number }[]>`SELECT count(*)::int AS open FROM whistle_reports WHERE company_id = ${actor.companyId} AND status = 'open'`;
  let reports: { id: number; category: string; body: string; contact: string | null; received_at: Date; acknowledged_at: Date | null; feedback_at: Date | null; status: string; closed_at: Date | null; outcome: string | null; messages: { sender: string; body: string; created_at: Date }[]; ackBy: Date; feedbackBy: Date; ackOverdue: boolean; feedbackOverdue: boolean }[] = [];
  if (handler) {
    const rows = await sql<{ id: number; category: Category; body_enc: string; contact_enc: string | null; received_at: Date; acknowledged_at: Date | null; feedback_at: Date | null; status: string; closed_at: Date | null; outcome_enc: string | null }[]>`
      SELECT id, category, body_enc, contact_enc, received_at, acknowledged_at, feedback_at, status, closed_at, outcome_enc FROM whistle_reports WHERE company_id = ${actor.companyId} ORDER BY status, received_at DESC LIMIT 200`;
    const msgs = rows.length ? await sql<{ report_id: number; sender: string; body_enc: string; created_at: Date }[]>`SELECT report_id, sender, body_enc, created_at FROM whistle_messages WHERE report_id IN ${sql(rows.map((r) => r.id))} ORDER BY id` : [];
    const now = new Date();
    reports = rows.map((r) => ({ id: r.id, category: CATEGORIES[r.category] ?? r.category, body: decrypt(r.body_enc), contact: r.contact_enc ? decrypt(r.contact_enc) : null, received_at: r.received_at, acknowledged_at: r.acknowledged_at, feedback_at: r.feedback_at,
      status: r.status, closed_at: r.closed_at, outcome: r.outcome_enc ? decrypt(r.outcome_enc) : null, messages: msgs.filter((m) => m.report_id === r.id).map((m) => ({ sender: m.sender, body: decrypt(m.body_enc), created_at: m.created_at })), ...deadlines(r, now) }));
  }
  return { settings: s ?? null, employees, required: employees >= THRESHOLD, handlers, members, handler, open, reports };
}

export async function enable(actor: Actor, active: boolean) {
  ownerOnly(actor);
  await sql`INSERT INTO whistle_settings (company_id, token, active) VALUES (${actor.companyId}, ${randomBytes(18).toString('base64url')}, ${active})
    ON CONFLICT (company_id) DO UPDATE SET active = EXCLUDED.active`;
  await auditBy(sql, actor, active ? 'whistle_enabled' : 'whistle_disabled', 'company', actor.companyId, {});
}

export async function setHandler(actor: Actor, userId: number, on: boolean) {
  ownerOnly(actor);
  if (on) { const [m] = await sql`SELECT 1 FROM memberships WHERE company_id = ${actor.companyId} AND user_id = ${userId}`; if (!m) throw new NotFoundError('Användaren'); }
  if (on) await sql`INSERT INTO whistle_handlers (company_id, user_id) VALUES (${actor.companyId}, ${userId}) ON CONFLICT DO NOTHING`;
  else await sql`DELETE FROM whistle_handlers WHERE company_id = ${actor.companyId} AND user_id = ${userId}`;
  await auditBy(sql, actor, on ? 'whistle_handler_added' : 'whistle_handler_removed', 'user', userId, {});
}

// ---------- Publikt (ingen inloggning – länken och ärendekoden är hemliga) ----------
const settingsByToken = async (token: string) => {
  const [s] = await sql<{ company_id: number; company: string }[]>`SELECT s.company_id, c.name AS company FROM whistle_settings s JOIN companies c ON c.id = s.company_id WHERE s.token = ${token} AND s.active`;
  return s ?? null;
};
export const publicInfo = settingsByToken;

export async function submit(token: string, input: Record<string, unknown>) {
  const s = await settingsByToken(token);
  if (!s) throw new NotFoundError('Kanalen');
  const category = String(input.category) as Category;
  if (!Object.prototype.hasOwnProperty.call(CATEGORIES, category)) throw new ValidationError('Välj vad rapporten gäller');
  const body = str(input, 'body', { required: true, label: 'Beskrivning', max: 20000 });
  if (body.length < 20) throw new ValidationError('Beskriv vad som har hänt (minst 20 tecken)');
  const contact = str(input, 'contact', { max: 300 });
  const code = caseCode(randomBytes(10));
  await sql`INSERT INTO whistle_reports ${sql({ company_id: s.company_id, code_hash: hashCode(code), category, body_enc: encrypt(body), contact_enc: contact ? encrypt(contact) : null })}`;
  return code;
}

async function reportByCode(token: string, code: string) {
  const s = await settingsByToken(token);
  if (!s || normalizeCode(code).length !== 16) return null;
  const [r] = await sql<{ id: number; status: string; acknowledged_at: Date | null }[]>`SELECT id, status, acknowledged_at FROM whistle_reports WHERE company_id = ${s.company_id} AND code_hash = ${hashCode(code)}`;
  return r ?? null;
}

/** Den som rapporterat följer ärendet med sin kod */
export async function thread(token: string, code: string) {
  const r = await reportByCode(token, code);
  if (!r) throw new NotFoundError('Ärendet');
  const msgs = await sql<{ sender: string; body_enc: string; created_at: Date }[]>`SELECT sender, body_enc, created_at FROM whistle_messages WHERE report_id = ${r.id} ORDER BY id`;
  return { status: r.status, acknowledged: !!r.acknowledged_at, messages: msgs.map((m) => ({ sender: m.sender, body: decrypt(m.body_enc), at: m.created_at.toISOString().slice(0, 10) })) };
}

export async function reporterReply(token: string, code: string, text: string) {
  const r = await reportByCode(token, code);
  if (!r) throw new NotFoundError('Ärendet');
  if (r.status === 'closed') throw new ConflictError('Ärendet är avslutat');
  const body = String(text ?? '').trim().slice(0, 10000);
  if (!body) throw new ValidationError('Skriv ett meddelande');
  await sql`INSERT INTO whistle_messages (report_id, sender, body_enc) VALUES (${r.id}, 'reporter', ${encrypt(body)})`;
  return thread(token, code);
}

// ---------- Handläggare ----------
const ownReport = async (actor: Actor, id: number) => {
  await requireHandler(actor);
  const [r] = await sql<{ status: string; acknowledged_at: Date | null }[]>`SELECT status, acknowledged_at FROM whistle_reports WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!r) throw new NotFoundError('Rapporten');
  return r;
};

export async function acknowledge(actor: Actor, id: number) {
  const r = await ownReport(actor, id);
  if (r.acknowledged_at) throw new ConflictError('Mottagandet är redan bekräftat');
  await sql.begin(async (tx) => {
    await tx`UPDATE whistle_reports SET acknowledged_at = now() WHERE id = ${id}`;
    await tx`INSERT INTO whistle_messages (report_id, sender, body_enc) VALUES (${id}, 'handler', ${encrypt('Vi har tagit emot din rapport och kommer att utreda den. Du får återkoppling här inom tre månader.')})`;
  });
  await auditBy(sql, actor, 'whistle_acknowledged', 'whistle_report', id, {});
}

export async function handlerReply(actor: Actor, id: number, input: Record<string, unknown>) {
  const r = await ownReport(actor, id);
  if (r.status === 'closed') throw new ConflictError('Ärendet är avslutat');
  const body = str(input, 'body', { required: true, label: 'Meddelande', max: 10000 });
  const feedback = input.feedback === 'on';
  await sql.begin(async (tx) => {
    await tx`INSERT INTO whistle_messages (report_id, sender, body_enc) VALUES (${id}, 'handler', ${encrypt(body)})`;
    await tx`UPDATE whistle_reports SET acknowledged_at = COALESCE(acknowledged_at, now()) ${feedback ? tx`, feedback_at = COALESCE(feedback_at, now())` : tx``} WHERE id = ${id}`;
  });
  await auditBy(sql, actor, 'whistle_reply', 'whistle_report', id, { feedback });
}

export async function close(actor: Actor, id: number, input: Record<string, unknown>) {
  const r = await ownReport(actor, id);
  if (r.status === 'closed') throw new ConflictError('Ärendet är redan avslutat');
  const outcome = str(input, 'outcome', { required: true, label: 'Utfall', max: 5000 });
  await sql`UPDATE whistle_reports SET status = 'closed', closed_at = now(), outcome_enc = ${encrypt(outcome)}, acknowledged_at = COALESCE(acknowledged_at, now()) WHERE id = ${id}`;
  await auditBy(sql, actor, 'whistle_closed', 'whistle_report', id, {});
}
