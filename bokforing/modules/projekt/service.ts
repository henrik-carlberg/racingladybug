import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { emit } from '@/lib/server/events';
import { today } from '@/lib/format';
import { parseDuration } from '@/lib/time';
import type { Actor } from '@/lib/services/actor';
import { date, int, optInt, str } from '@/lib/services/input';
import { saveDraftTx } from '@/lib/services/invoices';
import { createProject as createCoreProject, createTimeEntry, getProject as getCoreProject, type ProjectOut as CoreProject } from '@/lib/services/time';
import { economics, forecastHours, progress, STATUS, type Economics } from './calc';

type Db = Tx | typeof sql;
/** Kostnadskonton som kan kopplas till projekt (varor, tjänster, övriga externa kostnader) */
const COST_FROM = 4000, COST_TO = 6999;

export interface Details {
  manager_user_id: number | null; manager: string | null; status: keyof typeof STATUS; start_date: string | null; end_date: string | null;
  budget_hours: number; budget_revenue: number; budget_cost: number; internal_rate: number; description: string;
}
export interface Milestone { id: number; name: string; due_date: string | null; amount: number; done: boolean; done_at: string | null; invoice_id: number | null; invoice_status: string | null }
export interface Task {
  id: number; title: string; description: string; status: 'todo' | 'doing' | 'done'; assignee_user_id: number | null; assignee: string | null;
  estimate_minutes: number; logged_minutes: number; due_date: string | null; milestone_id: number | null; milestone: string | null; project_id: number; project: string;
}
export interface ProjectOut extends CoreProject {
  details: Details; milestones: Milestone[]; tasks: Task[]; economics: Economics; progress: number; forecast_hours: number | null;
  team: { user_id: number; name: string; minutes: number }[];
}

const DEFAULTS: Details = { manager_user_id: null, manager: null, status: 'planned', start_date: null, end_date: null, budget_hours: 0, budget_revenue: 0, budget_cost: 0, internal_rate: 0, description: '' };

async function details(db: Db, projectId: number): Promise<Details> {
  const [d] = await db<Details[]>`SELECT d.manager_user_id, u.name AS manager, d.status, to_char(d.start_date,'YYYY-MM-DD') AS start_date, to_char(d.end_date,'YYYY-MM-DD') AS end_date,
    d.budget_hours::float8 AS budget_hours, d.budget_revenue::bigint AS budget_revenue, d.budget_cost::bigint AS budget_cost, d.internal_rate::bigint AS internal_rate, d.description
    FROM proj_details d LEFT JOIN users u ON u.id = d.manager_user_id WHERE d.project_id = ${projectId}`;
  return d ? { ...d, budget_revenue: Number(d.budget_revenue), budget_cost: Number(d.budget_cost), internal_rate: Number(d.internal_rate) } : { ...DEFAULTS };
}

async function tasksOf(db: Db, companyId: number, f: { projectId?: number; assignee?: number; open?: boolean }): Promise<Task[]> {
  return db<Task[]>`SELECT t.id, t.title, t.description, t.status, t.assignee_user_id, u.name AS assignee, t.estimate_minutes,
      COALESCE((SELECT SUM(minutes) FROM time_entries e WHERE e.task_id = t.id), 0)::int AS logged_minutes,
      to_char(t.due_date,'YYYY-MM-DD') AS due_date, t.milestone_id, m.name AS milestone, t.project_id, p.name AS project
    FROM proj_tasks t JOIN projects p ON p.id = t.project_id LEFT JOIN users u ON u.id = t.assignee_user_id LEFT JOIN proj_milestones m ON m.id = t.milestone_id
    WHERE p.company_id = ${companyId} ${f.projectId ? db`AND t.project_id = ${f.projectId}` : db``} ${f.assignee ? db`AND t.assignee_user_id = ${f.assignee}` : db``}
      ${f.open ? db`AND t.status <> 'done'` : db``}
    ORDER BY CASE t.status WHEN 'doing' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END, t.due_date NULLS LAST, t.id`;
}

async function load(db: Db, companyId: number, id: number): Promise<ProjectOut> {
  const core = await getCoreProject(companyId, id);
  const d = await details(db, id);
  const milestones = await db<Milestone[]>`SELECT m.id, m.name, to_char(m.due_date,'YYYY-MM-DD') AS due_date, m.amount::bigint AS amount, m.done,
      to_char(m.done_at,'YYYY-MM-DD') AS done_at, m.invoice_id, i.status AS invoice_status
    FROM proj_milestones m LEFT JOIN invoices i ON i.id = m.invoice_id WHERE m.project_id = ${id} ORDER BY m.due_date NULLS LAST, m.id`;
  const tasks = await tasksOf(db, companyId, { projectId: id });
  const [money] = await db<{ revenue: number; cost: number }[]>`SELECT
    COALESCE((SELECT SUM(i.total_net) FROM invoices i
      WHERE i.project_id = ${id} AND i.status IN ('booked', 'paid', 'credited') AND i.company_id = ${companyId}), 0)
    + COALESCE((SELECT SUM(c.total_net) FROM invoices c JOIN invoices o ON o.id = c.credit_of_id WHERE o.project_id = ${id} AND c.company_id = ${companyId}), 0) AS revenue,
    COALESCE((SELECT SUM(amount) FROM proj_costs WHERE project_id = ${id}), 0)
    -- Kostnader som bokförts med projektet som dimension (leverantörsfakturor, kvitton, verifikationer) och inte redan kopplats manuellt
    + COALESCE((SELECT SUM(l.debit - l.credit) FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
        WHERE v.company_id = ${companyId} AND l.project_id = ${id} AND l.account_number BETWEEN 4000 AND 6999
          AND NOT EXISTS (SELECT 1 FROM proj_costs c WHERE c.voucher_id = v.id AND c.account = l.account_number)), 0) AS cost`;
  const team = await db<{ user_id: number; name: string; minutes: number }[]>`SELECT e.user_id, u.name, SUM(e.minutes)::int AS minutes
    FROM time_entries e JOIN users u ON u.id = e.user_id WHERE e.project_id = ${id} GROUP BY e.user_id, u.name ORDER BY 3 DESC`;
  const eco = economics({
    revenue: Number(money.revenue), externalCost: Number(money.cost), minutes: core.minutes_total, internalRate: d.internal_rate,
    budgetHours: d.budget_hours, budgetRevenue: d.budget_revenue, budgetCost: d.budget_cost,
  });
  const pr = progress(tasks);
  return { ...core, details: d, milestones: milestones.map((m) => ({ ...m, amount: Number(m.amount) })), tasks, economics: eco, progress: pr, forecast_hours: forecastHours(eco.hoursUsed, pr), team };
}

export const getProject = (companyId: number, id: number) => load(sql, companyId, id);

export async function listProjects(companyId: number, f: { status?: string } = {}) {
  const ids = await sql<{ id: number }[]>`SELECT p.id FROM projects p LEFT JOIN proj_details d ON d.project_id = p.id
    WHERE p.company_id = ${companyId} AND p.billing <> 'internal' ${f.status ? sql`AND COALESCE(d.status, 'planned') = ${f.status}` : sql``}
    ORDER BY CASE COALESCE(d.status, 'planned') WHEN 'active' THEN 0 WHEN 'planned' THEN 1 WHEN 'on_hold' THEN 2 ELSE 3 END, d.end_date NULLS LAST, p.name`;
  return Promise.all(ids.map((r) => load(sql, companyId, r.id)));
}

export async function members(companyId: number) {
  return sql<{ id: number; name: string }[]>`SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.company_id = ${companyId} ORDER BY u.name`;
}

async function assertMember(db: Db, companyId: number, userId: number | null) {
  if (!userId) return;
  const [m] = await db`SELECT 1 FROM memberships WHERE company_id = ${companyId} AND user_id = ${userId}`;
  if (!m) throw new ValidationError('Personen är inte användare i bolaget');
}

function readDetails(input: Record<string, unknown>) {
  const status = str(input, 'status') || 'planned';
  if (!STATUS[status]) throw new ValidationError('Ogiltig status');
  const start = date(input, 'start_date', 'Start', false) || null, end = date(input, 'end_date', 'Slut', false) || null;
  if (start && end && end < start) throw new ValidationError('Slutdatum är före startdatum');
  const hours = input.budget_hours == null || input.budget_hours === '' ? 0 : Number(String(input.budget_hours).replace(',', '.'));
  if (!Number.isFinite(hours) || hours < 0) throw new ValidationError('Ogiltig timbudget');
  const nonneg = (k: string, l: string) => { const v = optInt(input, k, l) ?? 0; if (v < 0) throw new ValidationError(`${l} kan inte vara negativ`); return v; };
  return {
    manager_user_id: optInt(input, 'manager_user_id', 'Projektledare'), status, start_date: start, end_date: end, budget_hours: hours,
    budget_revenue: nonneg('budget_revenue', 'Intäktsbudget'), budget_cost: nonneg('budget_cost', 'Kostnadsbudget'), internal_rate: nonneg('internal_rate', 'Internt timpris'),
    description: str(input, 'description'),
  };
}

/** Nytt projekt: skapar uppdraget (för tidrapportering och fakturering) och projektplanen */
export async function createProject(actor: Actor, input: Record<string, unknown>): Promise<ProjectOut> {
  const d = readDetails(input);
  await assertMember(sql, actor.companyId, d.manager_user_id);
  const core = await createCoreProject(actor, { ...input, activities: input.activities ?? 'Projektarbete' });
  await sql`INSERT INTO proj_details ${sql({ ...d, project_id: core.id, company_id: actor.companyId })}`;
  await auditBy(sql, actor, 'create', 'projekt.project', core.id);
  return getProject(actor.companyId, core.id);
}

/** Sparar projektplanen (för nya och befintliga uppdrag) */
export async function saveDetails(actor: Actor, projectId: number, input: Record<string, unknown>): Promise<ProjectOut> {
  await getCoreProject(actor.companyId, projectId);
  const d = readDetails(input);
  await assertMember(sql, actor.companyId, d.manager_user_id);
  await sql`INSERT INTO proj_details ${sql({ ...d, project_id: projectId, company_id: actor.companyId })}
    ON CONFLICT (project_id) DO UPDATE SET ${sql(d)}`;
  if (d.status === 'done') await sql`UPDATE projects SET active = false WHERE id = ${projectId}`;
  else await sql`UPDATE projects SET active = true WHERE id = ${projectId}`;
  await auditBy(sql, actor, 'update', 'projekt.project', projectId, { status: d.status });
  return getProject(actor.companyId, projectId);
}

// ---------- Delmoment ----------

export async function saveMilestone(actor: Actor, projectId: number, id: number | null, input: Record<string, unknown>) {
  await getCoreProject(actor.companyId, projectId);
  const amount = optInt(input, 'amount', 'Belopp') ?? 0;
  if (amount < 0) throw new ValidationError('Beloppet kan inte vara negativt');
  const f = { name: str(input, 'name', { required: true, label: 'Namn' }), due_date: date(input, 'due_date', 'Datum', false) || null, amount };
  if (id) {
    const r = await sql`UPDATE proj_milestones SET ${sql(f)} WHERE id = ${id} AND project_id = ${projectId} AND invoice_id IS NULL RETURNING id`;
    if (!r.length) throw new ConflictError('Delmomentet finns inte eller är redan fakturerat');
  } else {
    await sql`INSERT INTO proj_milestones ${sql({ ...f, project_id: projectId })}`;
  }
  await auditBy(sql, actor, id ? 'update' : 'create', 'projekt.milestone', id ?? projectId);
}

export async function setMilestoneDone(actor: Actor, projectId: number, id: number, done: boolean) {
  await getCoreProject(actor.companyId, projectId);
  const r = await sql`UPDATE proj_milestones SET done = ${done}, done_at = ${done ? today() : null} WHERE id = ${id} AND project_id = ${projectId} RETURNING id`;
  if (!r.length) throw new NotFoundError('Delmomentet');
  await auditBy(sql, actor, done ? 'complete' : 'reopen', 'projekt.milestone', id);
  if (done) await sql.begin((tx) => emit(tx, actor.companyId, 'projekt.milestone.done', { id, project_id: projectId }));
}

/** Fakturerar ett klart delmoment (fast pris / delfakturering) som fakturautkast */
export async function invoiceMilestone(actor: Actor, projectId: number, id: number) {
  const p = await getCoreProject(actor.companyId, projectId);
  return sql.begin(async (tx) => {
    const [m] = await tx<{ name: string; amount: number; done: boolean; invoice_id: number | null }[]>`
      SELECT name, amount::bigint AS amount, done, invoice_id FROM proj_milestones WHERE id = ${id} AND project_id = ${projectId} FOR UPDATE`;
    if (!m) throw new NotFoundError('Delmomentet');
    if (m.invoice_id) throw new ConflictError('Delmomentet är redan fakturerat');
    if (!m.done) throw new ValidationError('Markera delmomentet som klart innan det faktureras');
    if (!Number(m.amount)) throw new ValidationError('Delmomentet har inget belopp att fakturera');
    const inv = await saveDraftTx(tx, actor, null, {
      customer_id: p.customer_id, invoice_date: today(), notes: `Delfakturering enligt avtal: ${m.name}.`,
      lines: [{ description: `${p.name} – ${m.name}`, quantity: 1, unit: 'st', unit_price: Number(m.amount), vat_rate: p.vat_rate }],
    });
    await tx`UPDATE invoices SET project_id = ${projectId} WHERE id = ${inv.id}`;
    await tx`UPDATE proj_milestones SET invoice_id = ${inv.id} WHERE id = ${id}`;
    await auditBy(tx, actor, 'invoice', 'projekt.milestone', id, { invoice: inv.id });
    return inv;
  });
}

// ---------- Uppgifter ----------

export const myTasks = (companyId: number, userId: number) => tasksOf(sql, companyId, { assignee: userId, open: true });

export async function saveTask(actor: Actor, projectId: number, id: number | null, input: Record<string, unknown>) {
  await getCoreProject(actor.companyId, projectId);
  const assignee = optInt(input, 'assignee_user_id', 'Ansvarig');
  await assertMember(sql, actor.companyId, assignee);
  const milestone = optInt(input, 'milestone_id', 'Delmoment');
  if (milestone) {
    const [m] = await sql`SELECT 1 FROM proj_milestones WHERE id = ${milestone} AND project_id = ${projectId}`;
    if (!m) throw new ValidationError('Delmomentet finns inte i projektet');
  }
  const est = input.estimate == null || input.estimate === '' ? 0 : parseDuration(String(input.estimate));
  if (est == null) throw new ValidationError('Ange uppskattad tid, t.ex. 4 eller 1:30');
  const f = { title: str(input, 'title', { required: true, label: 'Uppgift' }), description: str(input, 'description'), assignee_user_id: assignee,
    milestone_id: milestone, estimate_minutes: est, due_date: date(input, 'due_date', 'Klart senast', false) || null };
  let tid = id ?? 0;
  if (id) {
    const r = await sql`UPDATE proj_tasks SET ${sql(f)} WHERE id = ${id} AND project_id = ${projectId} RETURNING id`;
    if (!r.length) throw new NotFoundError('Uppgiften');
  } else {
    [{ id: tid }] = await sql<{ id: number }[]>`INSERT INTO proj_tasks ${sql({ ...f, project_id: projectId })} RETURNING id`;
  }
  await auditBy(sql, actor, id ? 'update' : 'create', 'projekt.task', tid);
  return tid;
}

export async function setTaskStatus(actor: Actor, projectId: number, id: number, status: 'todo' | 'doing' | 'done') {
  if (!['todo', 'doing', 'done'].includes(status)) throw new ValidationError('Ogiltig status');
  await getCoreProject(actor.companyId, projectId);
  const r = await sql`UPDATE proj_tasks SET status = ${status}, done_at = ${status === 'done' ? new Date() : null} WHERE id = ${id} AND project_id = ${projectId} RETURNING id`;
  if (!r.length) throw new NotFoundError('Uppgiften');
  await auditBy(sql, actor, 'status', 'projekt.task', id, { status });
  if (status === 'done') await sql.begin((tx) => emit(tx, actor.companyId, 'projekt.task.done', { id, project_id: projectId }));
}

export async function deleteTask(actor: Actor, projectId: number, id: number) {
  await getCoreProject(actor.companyId, projectId);
  const r = await sql`DELETE FROM proj_tasks WHERE id = ${id} AND project_id = ${projectId} RETURNING id`;
  if (!r.length) throw new NotFoundError('Uppgiften');
  await auditBy(sql, actor, 'delete', 'projekt.task', id);
}

/** Rapporterar tid på en uppgift (blir en vanlig tidrad i tidrapporteringen) */
export async function logTime(actor: Actor, projectId: number, taskId: number, input: Record<string, unknown>) {
  const p = await getCoreProject(actor.companyId, projectId);
  const [t] = await sql<{ title: string }[]>`SELECT title FROM proj_tasks WHERE id = ${taskId} AND project_id = ${projectId}`;
  if (!t) throw new NotFoundError('Uppgiften');
  const activityId = optInt(input, 'activity_id', 'Aktivitet') ?? p.activities.find((a) => a.active)?.id;
  if (!activityId) throw new ValidationError('Projektet har ingen aktiv aktivitet att rapportera på');
  const e = await createTimeEntry(actor, { activity_id: activityId, date: str(input, 'date') || today(), hours: str(input, 'hours'), description: str(input, 'description') || t.title });
  await sql`UPDATE time_entries SET task_id = ${taskId} WHERE id = ${e.id}`;
  if ((await sql`SELECT 1 FROM proj_tasks WHERE id = ${taskId} AND status = 'todo'`).length) await sql`UPDATE proj_tasks SET status = 'doing' WHERE id = ${taskId}`;
  return e;
}

// ---------- Kostnader ----------

export async function projectCosts(projectId: number) {
  return sql<{ id: number; date: string; amount: number; description: string; voucher_id: number | null; account: number | null }[]>`
    SELECT id, to_char(date,'YYYY-MM-DD') AS date, amount::bigint AS amount, description, voucher_id, account FROM proj_costs WHERE project_id = ${projectId} ORDER BY date, id`;
}

/** Bokförda kostnader (4000–6999) under projektperioden som inte är kopplade till något projekt */
export async function costCandidates(companyId: number, projectId: number) {
  const d = await details(sql, projectId);
  const from = d.start_date ?? '1900-01-01', to = d.end_date ?? today();
  return sql<{ voucher_id: number; account: number; date: string; amount: number; description: string; ref: string }[]>`
    SELECT v.id AS voucher_id, l.account_number AS account, to_char(v.date,'YYYY-MM-DD') AS date, SUM(l.debit - l.credit)::bigint AS amount, v.description, v.series || v.number AS ref
    FROM vouchers v JOIN voucher_lines l ON l.voucher_id = v.id
    WHERE v.company_id = ${companyId} AND l.account_number BETWEEN ${COST_FROM} AND ${COST_TO} AND v.date BETWEEN ${from} AND ${to}::date + 30
      AND v.source_type NOT IN ('payroll', 'yearend', 'inventory')
      AND l.project_id IS NULL AND NOT EXISTS (SELECT 1 FROM proj_costs c WHERE c.voucher_id = v.id AND c.account = l.account_number)
    GROUP BY v.id, l.account_number HAVING SUM(l.debit - l.credit) > 0 ORDER BY v.date DESC, v.id DESC LIMIT 50`;
}

export async function linkCost(actor: Actor, projectId: number, voucherId: number, account: number) {
  await getCoreProject(actor.companyId, projectId);
  if (account < COST_FROM || account > COST_TO) throw new ValidationError('Bara kostnadskonton 4000–6999 kan kopplas');
  const [v] = await sql<{ date: string; description: string; amount: number }[]>`SELECT to_char(v.date,'YYYY-MM-DD') AS date, v.description, SUM(l.debit - l.credit)::bigint AS amount
    FROM vouchers v JOIN voucher_lines l ON l.voucher_id = v.id WHERE v.id = ${voucherId} AND v.company_id = ${actor.companyId} AND l.account_number = ${account} GROUP BY v.id`;
  if (!v) throw new ValidationError('Verifikationen har ingen rad på kontot');
  try {
    await sql`INSERT INTO proj_costs ${sql({ company_id: actor.companyId, project_id: projectId, date: v.date, amount: Number(v.amount), description: v.description, voucher_id: voucherId, account, created_by: actor.userId })}`;
  } catch (e) {
    if (String((e as Error).message).includes('proj_costs_voucher')) throw new ConflictError('Kostnaden är redan kopplad till ett projekt');
    throw e;
  }
  await auditBy(sql, actor, 'link_cost', 'projekt.project', projectId, { voucher: voucherId, account });
}

export async function addCost(actor: Actor, projectId: number, input: Record<string, unknown>) {
  await getCoreProject(actor.companyId, projectId);
  await sql`INSERT INTO proj_costs ${sql({ company_id: actor.companyId, project_id: projectId, date: date(input, 'date', 'Datum', false) || today(),
    amount: int(input, 'amount', 'Belopp'), description: str(input, 'description', { required: true, label: 'Beskrivning' }), created_by: actor.userId })}`;
  await auditBy(sql, actor, 'add_cost', 'projekt.project', projectId);
}

export async function removeCost(actor: Actor, projectId: number, costId: number) {
  const r = await sql`DELETE FROM proj_costs WHERE id = ${costId} AND project_id = ${projectId} AND company_id = ${actor.companyId} RETURNING id`;
  if (!r.length) throw new NotFoundError('Kostnaden');
  await auditBy(sql, actor, 'remove_cost', 'projekt.project', projectId, { cost: costId });
}
