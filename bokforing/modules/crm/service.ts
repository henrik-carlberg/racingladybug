import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { emit } from '@/lib/server/events';
import { auditBy } from '@/lib/server/audit';
import type { Actor } from '@/lib/services/actor';
import { bool, date, has, int, list, optInt, str, type Page } from '@/lib/services/input';

export const KINDS = { note: 'Anteckning', call: 'Samtal', meeting: 'Möte', email: 'E-post', task: 'Uppgift', system: 'Händelse' } as const;

export interface ActivityOut {
  id: number; object: 'crm.activity'; customer_id: number | null; kind: keyof typeof KINDS; subject: string; body: string;
  due_date: string | null; done: boolean; source_event: string | null; created_by: string | null; created_at: string;
}
export interface ContactOut { id: number; object: 'crm.contact'; customer_id: number; name: string; email: string; phone: string; title: string; created_at: string }

const ACOLS = () => sql`a.id, 'crm.activity' AS object, a.customer_id, a.kind, a.subject, a.body, to_char(a.due_date,'YYYY-MM-DD') AS due_date,
  a.done, a.source_event, u.name AS created_by, a.created_at`;

export async function listActivities(companyId: number, p: Page, f: { customer_id?: number | null; open_tasks?: boolean }) {
  const rows = await sql<ActivityOut[]>`SELECT ${ACOLS()} FROM crm_activities a LEFT JOIN users u ON u.id = a.created_by
    WHERE a.company_id = ${companyId} ${f.customer_id ? sql`AND a.customer_id = ${f.customer_id}` : sql``}
    ${f.open_tasks ? sql`AND a.kind = 'task' AND NOT a.done` : sql``}
    ${p.startingAfter ? sql`AND a.id < ${p.startingAfter}` : sql``} ORDER BY a.id DESC LIMIT ${p.limit + 1}`;
  return list([...rows], p);
}

async function assertCustomer(db: Tx | typeof sql, companyId: number, customerId: number | null) {
  if (customerId == null) return;
  const r = await db`SELECT 1 FROM customers WHERE id = ${customerId} AND company_id = ${companyId}`;
  if (!r.length) throw new ValidationError('Kunden finns inte');
}

export async function createActivity(actor: Actor, input: Record<string, unknown>): Promise<ActivityOut> {
  const kind = (str(input, 'kind') || 'note') as keyof typeof KINDS;
  if (!(kind in KINDS) || kind === 'system') throw new ValidationError('Ogiltig aktivitetstyp');
  const customerId = optInt(input, 'customer_id', 'Kund');
  return sql.begin(async (tx) => {
    await assertCustomer(tx, actor.companyId, customerId);
    const [{ id }] = await tx<{ id: number }[]>`INSERT INTO crm_activities ${tx({
      company_id: actor.companyId, customer_id: customerId, kind, subject: str(input, 'subject', { required: true, label: 'Rubrik', max: 300 }),
      body: str(input, 'body', { max: 20000 }), due_date: date(input, 'due_date', 'Datum', false) || null, created_by: actor.userId,
    })} RETURNING id`;
    const [a] = await tx<ActivityOut[]>`SELECT ${ACOLS()} FROM crm_activities a LEFT JOIN users u ON u.id = a.created_by WHERE a.id = ${id}`;
    await auditBy(tx, actor, 'create', 'crm.activity', id);
    await emit(tx, actor.companyId, 'crm.activity.created', a);
    return a;
  });
}

export async function updateActivity(actor: Actor, id: number, input: Record<string, unknown>): Promise<ActivityOut> {
  return sql.begin(async (tx) => {
    const f: Record<string, unknown> = {};
    if (has(input, 'done')) f.done = bool(input, 'done');
    if (has(input, 'subject')) f.subject = str(input, 'subject', { required: true, label: 'Rubrik', max: 300 });
    if (has(input, 'body')) f.body = str(input, 'body', { max: 20000 });
    const r = Object.keys(f).length
      ? await tx`UPDATE crm_activities SET ${tx(f)} WHERE id = ${id} AND company_id = ${actor.companyId} AND kind <> 'system' RETURNING id`
      : await tx`SELECT id FROM crm_activities WHERE id = ${id} AND company_id = ${actor.companyId}`;
    if (!r.length) throw new NotFoundError('Aktiviteten');
    const [a] = await tx<ActivityOut[]>`SELECT ${ACOLS()} FROM crm_activities a LEFT JOIN users u ON u.id = a.created_by WHERE a.id = ${id}`;
    await auditBy(tx, actor, 'update', 'crm.activity', id);
    return a;
  });
}

export async function listContacts(companyId: number, p: Page, customerId?: number | null) {
  const rows = await sql<ContactOut[]>`SELECT id, 'crm.contact' AS object, customer_id, name, email, phone, title, created_at
    FROM crm_contacts WHERE company_id = ${companyId} ${customerId ? sql`AND customer_id = ${customerId}` : sql``}
    ${p.startingAfter ? sql`AND id > ${p.startingAfter}` : sql``} ORDER BY id LIMIT ${p.limit + 1}`;
  return list([...rows], p);
}

export async function createContact(actor: Actor, input: Record<string, unknown>): Promise<ContactOut> {
  const customerId = int(input, 'customer_id', 'Kund');
  return sql.begin(async (tx) => {
    await assertCustomer(tx, actor.companyId, customerId);
    const [c] = await tx<ContactOut[]>`INSERT INTO crm_contacts ${tx({
      company_id: actor.companyId, customer_id: customerId, name: str(input, 'name', { required: true, label: 'Namn' }),
      email: str(input, 'email'), phone: str(input, 'phone'), title: str(input, 'title'),
    })} RETURNING id, 'crm.contact' AS object, customer_id, name, email, phone, title, created_at`;
    await auditBy(tx, actor, 'create', 'crm.contact', c.id);
    return c;
  });
}

/** Automatisk aktivitet från en händelse i bokföringen (körs i händelsens transaktion) */
export async function logSystemActivity(tx: Tx, companyId: number, customerId: number | null, subject: string, eventId: string) {
  await tx`INSERT INTO crm_activities (company_id, customer_id, kind, subject, source_event)
    VALUES (${companyId}, ${customerId}, 'system', ${subject}, ${eventId})`;
}
