import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { audit } from '@/lib/server/audit';
import { addDays, today } from '@/lib/format';
import { board, summary, type BoardDeadline, type BoardTask } from '@/lib/firm-tasks';
import { companyDeadlines } from './deadlines';
import { requireFirm } from './firms';

async function client(firmId: number, companyId: number) {
  const [c] = await sql<{ name: string }[]>`SELECT c.name FROM firm_clients fc JOIN companies c ON c.id = fc.company_id WHERE fc.firm_id = ${firmId} AND fc.company_id = ${companyId}`;
  if (!c) throw new NotFoundError('Kunden');
  return c;
}
async function member(firmId: number, userId: number | null) {
  if (userId == null) return null;
  const [m] = await sql<{ user_id: number }[]>`SELECT user_id FROM firm_members WHERE firm_id = ${firmId} AND user_id = ${userId}`;
  if (!m) throw new ValidationError('Den ansvarige ska vara med i byrån');
  return userId;
}
const isoDate = (v: unknown, label: string) => { const s = String(v ?? ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new ValidationError(`Ange ${label}`); return s; };

/** Arbetstavlan för byrån: kundernas deadlines (de närmaste 60 dagarna och försenade) och byråns egna uppgifter */
export async function firmBoard(userId: number, firmId: number, companies: { id: number; name: string }[], f: { mine?: boolean; companyId?: number | null; showDone?: boolean } = {}) {
  await requireFirm(userId, firmId);
  const t = today();
  const deadlines: BoardDeadline[] = [];
  for (const c of companies) for (const d of await companyDeadlines(c.id, { to: addDays(t, 60) }))
    deadlines.push({ companyId: c.id, company: c.name, key: d.key, title: d.title, due: d.due, status: d.status, href: d.href });
  const ids = companies.map((c) => c.id);
  const tasks = ids.length ? (await sql<{ id: number; company_id: number; deadline_key: string | null; title: string; due: string; assignee: number | null; assignee_name: string | null; status: 'open' | 'done' }[]>`
    SELECT t.id, t.company_id, t.deadline_key, t.title, to_char(t.due,'YYYY-MM-DD') AS due, t.assignee, u.name AS assignee_name, t.status
    FROM firm_tasks t LEFT JOIN users u ON u.id = t.assignee WHERE t.firm_id = ${firmId} AND t.company_id IN ${sql(ids)}`)
    .map((r): BoardTask => ({ id: r.id, companyId: r.company_id, deadlineKey: r.deadline_key, title: r.title, due: r.due, assignee: r.assignee, assigneeName: r.assignee_name, status: r.status })) : [];
  const names = new Map(companies.map((c) => [c.id, c.name]));
  const rows = board(deadlines, tasks, t, { assignee: f.mine ? userId : null, companyId: f.companyId ?? null, showDone: f.showDone });
  const members = await sql<{ id: number; name: string }[]>`SELECT u.id, u.name FROM firm_members m JOIN users u ON u.id = m.user_id WHERE m.firm_id = ${firmId} ORDER BY u.name`;
  return { rows: rows.map((r) => ({ ...r, company: r.company || names.get(r.companyId) || '' })), summary: summary(board(deadlines, tasks, t)), members };
}

/** Tilldelar en deadline eller uppgift till en kollega (skapar uppgiften för deadlinen vid behov) */
export async function assign(userId: number, firmId: number, input: { company_id: number; deadline_key?: string; task_id?: number; title?: string; due?: string; assignee: number | null }) {
  await requireFirm(userId, firmId);
  await client(firmId, input.company_id);
  const assignee = await member(firmId, input.assignee);
  if (input.task_id) {
    const r = await sql`UPDATE firm_tasks SET assignee = ${assignee} WHERE id = ${input.task_id} AND firm_id = ${firmId} AND company_id = ${input.company_id} RETURNING id`;
    if (!r.length) throw new NotFoundError('Uppgiften');
  } else {
    const key = String(input.deadline_key ?? '').slice(0, 120);
    if (!key) throw new ValidationError('Välj deadline');
    const d = (await companyDeadlines(input.company_id, { from: '2000-01-01', to: addDays(today(), 400) })).find((x) => x.key === key);
    if (!d) throw new NotFoundError('Deadlinen');
    await sql`INSERT INTO firm_tasks ${sql({ firm_id: firmId, company_id: input.company_id, deadline_key: key, title: d.title, due: d.due, assignee, created_by: userId })}
      ON CONFLICT (firm_id, company_id, deadline_key) WHERE deadline_key IS NOT NULL DO UPDATE SET assignee = EXCLUDED.assignee`;
  }
  await audit(sql, { companyId: input.company_id, userId, action: 'firm_assign', entity: 'firm_task', details: { firm: firmId, assignee } });
}

/** Egen uppgift för en kund (t.ex. "Hämta in underlag för bilförmån") */
export async function addTask(userId: number, firmId: number, input: { company_id: number; title: string; due: string; assignee: number | null }) {
  await requireFirm(userId, firmId);
  await client(firmId, input.company_id);
  const title = String(input.title ?? '').trim().slice(0, 200);
  if (!title) throw new ValidationError('Beskriv uppgiften');
  const due = isoDate(input.due, 'datum');
  const assignee = await member(firmId, input.assignee);
  const [r] = await sql<{ id: number }[]>`INSERT INTO firm_tasks ${sql({ firm_id: firmId, company_id: input.company_id, title, due, assignee, created_by: userId })} RETURNING id`;
  return r.id;
}

/** Klar: uppgiften bockas av, och en deadline markeras även som klar hos kunden */
export async function complete(userId: number, firmId: number, input: { company_id: number; task_id?: number; deadline_key?: string }) {
  await requireFirm(userId, firmId);
  await client(firmId, input.company_id);
  await sql.begin(async (tx) => {
    let key = input.deadline_key ?? null;
    if (input.task_id) {
      const [t] = await tx<{ deadline_key: string | null }[]>`UPDATE firm_tasks SET status = 'done', done_by = ${userId}, done_at = now() WHERE id = ${input.task_id} AND firm_id = ${firmId} AND company_id = ${input.company_id} RETURNING deadline_key`;
      if (!t) throw new NotFoundError('Uppgiften');
      key = t.deadline_key;
    } else if (key) {
      const d = (await companyDeadlines(input.company_id, { from: '2000-01-01', to: addDays(today(), 400) })).find((x) => x.key === key);
      if (!d) throw new NotFoundError('Deadlinen');
      await tx`INSERT INTO firm_tasks ${tx({ firm_id: firmId, company_id: input.company_id, deadline_key: key, title: d.title, due: d.due, status: 'done', done_by: userId, done_at: new Date(), created_by: userId })}
        ON CONFLICT (firm_id, company_id, deadline_key) WHERE deadline_key IS NOT NULL DO UPDATE SET status = 'done', done_by = EXCLUDED.done_by, done_at = now()`;
    }
    // Deadlinen bockas av hos kunden bara om kollegan själv har åtkomst till bolaget
    const [m] = key ? await tx`SELECT 1 FROM memberships WHERE company_id = ${input.company_id} AND user_id = ${userId}` : [];
    if (key && m) await tx`INSERT INTO deadline_marks (company_id, key, done_by) VALUES (${input.company_id}, ${key}, ${userId}) ON CONFLICT DO NOTHING`;
    await audit(tx, { companyId: input.company_id, userId, action: 'firm_task_done', entity: 'firm_task', details: { firm: firmId, key } });
  });
}
