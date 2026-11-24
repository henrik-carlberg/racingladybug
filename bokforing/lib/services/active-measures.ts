import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { today } from '@/lib/format';
import { AREAS, DOC_THRESHOLD, progress, type Area } from '@/lib/active-measures';
import type { Actor } from './actor';
import { date, str } from './input';

export async function overview(companyId: number, yearIn?: number) {
  const t = today(), year = yearIn || Number(t.slice(0, 4));
  const rows = await sql<{ id: number; area: Area; finding: string; measure: string; owner: string; due_date: string | null; done_on: string | null; follow_up: string }[]>`
    SELECT id, area, finding, measure, owner, to_char(due_date,'YYYY-MM-DD') AS due_date, to_char(done_on,'YYYY-MM-DD') AS done_on, follow_up FROM active_measures WHERE company_id = ${companyId} AND year = ${year} ORDER BY area, id`;
  const [policy] = await sql<{ guidelines: string; routines: string; adopted_on: string }[]>`SELECT guidelines, routines, to_char(adopted_on,'YYYY-MM-DD') AS adopted_on FROM harassment_policies WHERE company_id = ${companyId}`;
  const [{ employees }] = await sql<{ employees: number }[]>`SELECT count(*)::int AS employees FROM employees WHERE company_id = ${companyId} AND active`;
  const [{ open }] = await sql<{ open: number }[]>`SELECT count(*)::int AS open FROM pay_survey_analyses WHERE company_id = ${companyId} AND year = ${year} AND NOT objective AND (due_date IS NULL OR due_date >= ${t})`;
  return { year, rows: rows.map((r) => ({ ...r, overdue: !!r.measure && !r.done_on && !!r.due_date && r.due_date < t })), policy: policy ?? null, employees, documentation: employees >= DOC_THRESHOLD, payActions: open,
    progress: progress(rows, !!policy, t) };
}

export async function add(actor: Actor, input: Record<string, unknown>) {
  const area = String(input.area) as Area;
  if (!Object.prototype.hasOwnProperty.call(AREAS, area)) throw new ValidationError('Välj område');
  const measure = str(input, 'measure', { max: 2000 });
  const due = date(input, 'due_date', 'Klart senast', false) || null;
  if (measure && !due) throw new ValidationError('Ange när åtgärden ska vara genomförd');
  const year = Number(today().slice(0, 4));
  await sql`INSERT INTO active_measures ${sql({ company_id: actor.companyId, year, area, finding: str(input, 'finding', { required: true, label: 'Undersökning och analys', max: 4000 }), measure, owner: str(input, 'owner', { max: 100 }), due_date: due, created_by: actor.userId })}`;
  await auditBy(sql, actor, 'active_measure', 'company', actor.companyId, { area });
}

/** Genomförd åtgärd och uppföljning av om den gav effekt */
export async function complete(actor: Actor, id: number, input: Record<string, unknown>) {
  const follow = str(input, 'follow_up', { required: true, label: 'Uppföljning', max: 2000 });
  const r = await sql`UPDATE active_measures SET done_on = COALESCE(done_on, ${today()}), follow_up = ${follow} WHERE id = ${id} AND company_id = ${actor.companyId} AND measure <> ''`;
  if (!r.count) throw new NotFoundError('Åtgärden');
}

export async function savePolicy(actor: Actor, input: Record<string, unknown>) {
  const adopted = date(input, 'adopted_on', 'Antagen', false) || today();
  await sql`INSERT INTO harassment_policies (company_id, guidelines, routines, adopted_on, updated_by) VALUES (${actor.companyId}, ${str(input, 'guidelines', { required: true, label: 'Riktlinjer', max: 8000 })}, ${str(input, 'routines', { required: true, label: 'Rutiner', max: 8000 })}, ${adopted}, ${actor.userId})
    ON CONFLICT (company_id) DO UPDATE SET guidelines = EXCLUDED.guidelines, routines = EXCLUDED.routines, adopted_on = EXCLUDED.adopted_on, updated_by = EXCLUDED.updated_by`;
}
