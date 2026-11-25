import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { today } from '@/lib/format';
import { PERMISSIONS, type Permission } from '@/lib/permissions';
import { STANDARD_TASKS, analyse, reviewDue, type Task } from '@/lib/continuity';
import type { Actor } from './actor';
import { str } from './input';

export async function overview(companyId: number) {
  const members = await sql<{ id: number; name: string; role: string; permissions: string[] | null }[]>`SELECT u.id, u.name, m.role, m.permissions FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.company_id = ${companyId} ORDER BY u.name`;
  const tasks = await sql<(Task & { routine: string })[]>`SELECT id, name, permission, responsible_id, substitute_id, routine FROM continuity_tasks WHERE company_id = ${companyId} ORDER BY id`;
  const powers = await sql<{ name: string; counterparty: string; holder: string }[]>`SELECT name, counterparty, holder FROM authorizations WHERE company_id = ${companyId} AND kind = 'power_of_attorney' AND status = 'active' AND (valid_until IS NULL OR valid_until >= ${today()})`;
  const contacts = await sql<{ id: number; name: string; role: string; phone: string; email: string; notes: string }[]>`SELECT id, name, role, phone, email, notes FROM continuity_contacts WHERE company_id = ${companyId} ORDER BY role, name`;
  const [plan] = await sql<{ crisis_routine: string; reviewed_on: string | null; reviewer: string | null }[]>`SELECT p.crisis_routine, to_char(p.reviewed_on,'YYYY-MM-DD') AS reviewed_on, u.name AS reviewer FROM continuity_plans p LEFT JOIN users u ON u.id = p.reviewed_by WHERE p.company_id = ${companyId}`;
  const a = analyse(members, tasks, powers);
  const routines = new Map(tasks.map((t) => [t.id, t.routine]));
  return { members, contacts, plan: plan ?? { crisis_routine: '', reviewed_on: null, reviewer: null }, ...a, tasks: a.tasks.map((t) => ({ ...t, routine: routines.get(t.id) ?? '' })),
    reviewDue: reviewDue(plan?.reviewed_on ?? null, today()), powers: powers.length };
}

const member = async (companyId: number, v: unknown) => {
  if (!String(v ?? '')) return null;
  const [m] = await sql<{ user_id: number }[]>`SELECT user_id FROM memberships WHERE company_id = ${companyId} AND user_id = ${Number(v) || 0}`;
  if (!m) throw new ValidationError('Personen har inte tillgång till bolaget');
  return m.user_id;
};
const perm = (v: unknown): Permission | null => { const s = String(v ?? ''); if (!s) return null; if (!(s in PERMISSIONS)) throw new ValidationError('Okänd behörighet'); return s as Permission; };

export async function saveTask(actor: Actor, id: number | null, input: Record<string, unknown>) {
  const row = { name: str(input, 'name', { required: true, label: 'Uppgift', max: 200 }), permission: perm(input.permission), responsible_id: await member(actor.companyId, input.responsible_id),
    substitute_id: await member(actor.companyId, input.substitute_id), routine: str(input, 'routine', { max: 2000 }) };
  if (id) {
    const r = await sql`UPDATE continuity_tasks SET ${sql(row)} WHERE id = ${id} AND company_id = ${actor.companyId} RETURNING id`;
    if (!r.length) throw new NotFoundError('Uppgiften');
  } else await sql`INSERT INTO continuity_tasks ${sql({ ...row, company_id: actor.companyId })}`;
  await auditBy(sql, actor, 'task', 'continuity', id ?? 0, { name: row.name });
}

export async function addStandard(actor: Actor) {
  const existing = new Set((await sql<{ name: string }[]>`SELECT name FROM continuity_tasks WHERE company_id = ${actor.companyId}`).map((r) => r.name));
  const add = STANDARD_TASKS.filter((t) => !existing.has(t.name));
  for (const t of add) await sql`INSERT INTO continuity_tasks ${sql({ company_id: actor.companyId, name: t.name, permission: t.permission })}`;
  return add.length;
}

export async function removeTask(actor: Actor, id: number) {
  await sql`DELETE FROM continuity_tasks WHERE id = ${id} AND company_id = ${actor.companyId}`;
}

export async function saveContact(actor: Actor, input: Record<string, unknown>) {
  await sql`INSERT INTO continuity_contacts ${sql({ company_id: actor.companyId, name: str(input, 'name', { required: true, label: 'Namn', max: 200 }), role: str(input, 'role', { max: 100 }),
    phone: str(input, 'phone', { max: 50 }), email: str(input, 'email', { max: 200 }), notes: str(input, 'notes', { max: 500 }) })}`;
}
export async function removeContact(actor: Actor, id: number) {
  await sql`DELETE FROM continuity_contacts WHERE id = ${id} AND company_id = ${actor.companyId}`;
}

export async function savePlan(actor: Actor, input: Record<string, unknown>, review: boolean) {
  const routine = str(input, 'crisis_routine', { max: 5000 });
  await sql`INSERT INTO continuity_plans (company_id, crisis_routine) VALUES (${actor.companyId}, ${routine}) ON CONFLICT (company_id) DO UPDATE SET crisis_routine = EXCLUDED.crisis_routine`;
  if (review) await sql`UPDATE continuity_plans SET reviewed_on = ${today()}, reviewed_by = ${actor.userId} WHERE company_id = ${actor.companyId}`;
  await auditBy(sql, actor, review ? 'review' : 'plan', 'continuity', 0);
}
