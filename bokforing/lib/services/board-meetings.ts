import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { today } from '@/lib/format';
import { KINDS, TEMPLATES, defaultAgenda, followUp, minutesHtml, missingAgmItems, quorum, type MeetingKind, type Template } from '@/lib/board-meetings';
import type { Actor } from './actor';
import { createDocument, sendDocument } from './documents';
import { date, str } from './input';

type Meeting = { id: number; kind: MeetingKind; date: string; place: string; status: string; chair: string; secretary: string; present: string[]; document_id: number | null; doc_status: string | null };
type Item = { id: number; meeting_id: number; position: number; template: Template; title: string; decision: string; owner: string; due_date: string | null; done_on: string | null };

/** Ordinarie ledamöter för mandatperioden som gäller vid mötet */
async function members(companyId: number, d: string) {
  const r = await sql<{ name: string }[]>`SELECT name FROM board_members WHERE company_id = ${companyId} AND role NOT ILIKE '%suppleant%'
    AND agm_date = (SELECT max(agm_date) FROM board_members WHERE company_id = ${companyId} AND agm_date <= ${d}) ORDER BY name`;
  return r.map((x) => x.name);
}

export async function overview(companyId: number) {
  const t = today();
  const meetings = await sql<Meeting[]>`SELECT m.id, m.kind, to_char(m.date,'YYYY-MM-DD') AS date, m.place, m.status, m.chair, m.secretary, m.present, m.document_id, d.status AS doc_status
    FROM board_meetings m LEFT JOIN documents d ON d.id = m.document_id AND d.company_id = m.company_id WHERE m.company_id = ${companyId} ORDER BY m.date DESC, m.id DESC LIMIT 100`;
  const items = meetings.length ? await sql<Item[]>`SELECT id, meeting_id, position, template, title, decision, owner, to_char(due_date,'YYYY-MM-DD') AS due_date, to_char(done_on,'YYYY-MM-DD') AS done_on
    FROM board_items WHERE company_id = ${companyId} AND meeting_id IN ${sql(meetings.map((m) => m.id))} ORDER BY position, id` : [];
  const list = await Promise.all(meetings.map(async (m) => {
    const own = items.filter((i) => i.meeting_id === m.id);
    return { ...m, items: own, quorum: m.kind === 'board' ? quorum(await members(companyId, m.date), m.present) : null, missing: m.kind === 'agm' ? missingAgmItems(own.map((i) => i.template)) : [] };
  }));
  const decisions = followUp(items, t).map((i) => ({ ...i, meeting: meetings.find((m) => m.id === i.meeting_id)! }));
  return { meetings: list, decisions, boardMembers: await members(companyId, t) };
}

export async function createMeeting(actor: Actor, input: Record<string, unknown>) {
  const kind = String(input.kind) as MeetingKind;
  if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) throw new ValidationError('Välj typ av möte');
  const d = date(input, 'date', 'Datum');
  return sql.begin(async (tx) => {
    const [m] = await tx<{ id: number }[]>`INSERT INTO board_meetings ${tx({ company_id: actor.companyId, kind, date: d, place: str(input, 'place', { max: 200 }), created_by: actor.userId })} RETURNING id`;
    const agenda = defaultAgenda(kind);
    for (let i = 0; i < agenda.length; i++) await tx`INSERT INTO board_items ${tx({ meeting_id: m.id, company_id: actor.companyId, position: (i + 1) * 10, template: agenda[i], title: TEMPLATES[agenda[i]] })}`;
    await auditBy(tx, actor, 'board_meeting', 'board_meeting', m.id, { kind, date: d });
    return m.id;
  });
}

const ownMeeting = async (actor: Actor, id: number) => {
  const [m] = await sql<Meeting[]>`SELECT id, kind, to_char(date,'YYYY-MM-DD') AS date, place, status, chair, secretary, present, document_id, NULL AS doc_status FROM board_meetings WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!m) throw new NotFoundError('Mötet');
  return m;
};

export async function addItem(actor: Actor, meetingId: number, input: Record<string, unknown>) {
  const m = await ownMeeting(actor, meetingId);
  if (m.status === 'sent') throw new ConflictError('Protokollet är redan skickat för justering');
  const template = (Object.prototype.hasOwnProperty.call(TEMPLATES, String(input.template)) ? String(input.template) : 'other') as Template;
  const title = str(input, 'title', { max: 300 }) || TEMPLATES[template];
  // Nya punkter läggs före "Mötets avslutande"
  await sql`INSERT INTO board_items (meeting_id, company_id, position, template, title)
    SELECT ${meetingId}, ${actor.companyId}, COALESCE((SELECT max(position) FROM board_items WHERE meeting_id = ${meetingId} AND template <> 'close'), 0) + 1, ${template}, ${title}`;
}

export async function decide(actor: Actor, itemId: number, input: Record<string, unknown>) {
  const [i] = await sql<{ status: string }[]>`SELECT m.status FROM board_items i JOIN board_meetings m ON m.id = i.meeting_id WHERE i.id = ${itemId} AND i.company_id = ${actor.companyId}`;
  if (!i) throw new NotFoundError('Punkten');
  if (i.status === 'sent') throw new ConflictError('Protokollet är redan skickat för justering');
  await sql`UPDATE board_items SET decision = ${str(input, 'decision', { max: 2000 })}, owner = ${str(input, 'owner', { max: 100 })}, due_date = ${date(input, 'due_date', 'Klart senast', false) || null} WHERE id = ${itemId}`;
}

export async function markDone(actor: Actor, itemId: number) {
  const r = await sql`UPDATE board_items SET done_on = ${today()} WHERE id = ${itemId} AND company_id = ${actor.companyId} AND done_on IS NULL AND decision <> ''`;
  if (!r.count) throw new NotFoundError('Beslutet');
}

/** Mötet hålls: närvaro, ordförande och protokollförare; ett styrelsemöte måste vara beslutfört */
export async function hold(actor: Actor, id: number, input: Record<string, unknown>) {
  const m = await ownMeeting(actor, id);
  if (m.status === 'sent') throw new ConflictError('Protokollet är redan skickat för justering');
  const present = String(input.present ?? '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 50);
  if (!present.length) throw new ValidationError('Ange vilka som är närvarande');
  if (m.kind === 'board') {
    const q = quorum(await members(actor.companyId, m.date), present);
    if (!q.ok) throw new ValidationError(`Styrelsen är inte beslutför: ${q.here} av ${q.members} ledamöter är närvarande, minst ${q.needed} krävs`);
  }
  await sql`UPDATE board_meetings SET status = 'held', present = ${present}, chair = ${str(input, 'chair', { max: 100 })}, secretary = ${str(input, 'secretary', { max: 100 })} WHERE id = ${id}`;
}

/** Protokollet skickas för e-signering till ordföranden och justeraren */
export async function sendMinutes(actor: Actor, id: number, input: Record<string, unknown>) {
  const m = await ownMeeting(actor, id);
  if (m.status !== 'held') throw new ConflictError(m.status === 'sent' ? 'Protokollet är redan skickat' : 'Registrera närvaron innan protokollet skickas');
  const items = await sql<Item[]>`SELECT title, template, decision, owner, to_char(due_date,'YYYY-MM-DD') AS due_date FROM board_items WHERE meeting_id = ${id} ORDER BY position, id`;
  if (m.kind === 'agm') { const miss = missingAgmItems(items.map((i) => i.template)); if (miss.length) throw new ValidationError(`Årsstämman ska besluta om: ${miss.map((t) => TEMPLATES[t].toLowerCase()).join(', ')}`); }
  const signers = [0, 1].map((n) => ({ name: str(input, `signer_name_${n}`, { max: 100 }), email: str(input, `signer_email_${n}`, { max: 200 }) })).filter((s) => s.name);
  if (!signers.length) throw new ValidationError('Ange vem som justerar protokollet');
  const [co] = await sql<{ name: string; orgnr: string }[]>`SELECT name, orgnr FROM companies WHERE id = ${actor.companyId}`;
  const doc = await createDocument(actor, { title: `Protokoll ${KINDS[m.kind].toLowerCase()} ${m.date}`, html: minutesHtml(co, m, items), source_module: 'styrelsemoten', source_id: id, signers });
  await sendDocument(actor, doc.id);
  await sql`UPDATE board_meetings SET status = 'sent', document_id = ${doc.id} WHERE id = ${id} AND company_id = ${actor.companyId}`;
  return doc.id;
}
