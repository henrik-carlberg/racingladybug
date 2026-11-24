import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { today } from '@/lib/format';
import { CHECKLIST, INCIDENTS, missingReports, reviewProgress, riskLevel, type IncidentKind } from '@/lib/work-environment';
import type { Actor } from './actor';
import { date, int, optInt, str } from './input';

export async function overview(companyId: number) {
  const t = today(), year = Number(t.slice(0, 4));
  const risks = await sql<{ id: number; area: string; hazard: string; probability: number; consequence: number; measure: string; owner: string; due_date: string | null; done_on: string | null }[]>`
    SELECT id, area, hazard, probability, consequence, measure, owner, to_char(due_date,'YYYY-MM-DD') AS due_date, to_char(done_on,'YYYY-MM-DD') AS done_on FROM work_risks WHERE company_id = ${companyId} ORDER BY done_on NULLS FIRST, probability * consequence DESC, id`;
  const incidents = await sql<{ id: number; date: string; kind: IncidentKind; description: string; employee: string | null; days_absent: number; reported_av_on: string | null; reported_fk_on: string | null; measure: string }[]>`
    SELECT i.id, to_char(i.date,'YYYY-MM-DD') AS date, i.kind, i.description, e.first_name || ' ' || e.last_name AS employee, i.days_absent, to_char(i.reported_av_on,'YYYY-MM-DD') AS reported_av_on, to_char(i.reported_fk_on,'YYYY-MM-DD') AS reported_fk_on, i.measure
    FROM work_incidents i LEFT JOIN employees e ON e.id = i.employee_id WHERE i.company_id = ${companyId} ORDER BY i.date DESC, i.id DESC LIMIT 200`;
  const [review] = await sql<{ checked: string[]; note: string; done_on: string | null }[]>`SELECT checked, note, to_char(done_on,'YYYY-MM-DD') AS done_on FROM sam_reviews WHERE company_id = ${companyId} AND year = ${year}`;
  const employees = await sql<{ id: number; name: string }[]>`SELECT id, first_name || ' ' || last_name AS name FROM employees WHERE company_id = ${companyId} AND active ORDER BY 2`;
  const ytd = incidents.filter((i) => i.date.startsWith(String(year)));
  return {
    year, employees,
    risks: risks.map((r) => ({ ...r, ...riskLevel(r.probability, r.consequence), overdue: !r.done_on && !!r.due_date && r.due_date < t })),
    incidents: incidents.map((i) => ({ ...i, missing: missingReports(i, t) })),
    stats: Object.fromEntries(Object.keys(INCIDENTS).map((k) => [k, ytd.filter((i) => i.kind === k).length])) as Record<IncidentKind, number>,
    absentDays: ytd.reduce((s, i) => s + i.days_absent, 0),
    review: { checked: review?.checked ?? [], note: review?.note ?? '', done_on: review?.done_on ?? null, ...reviewProgress(review?.checked ?? []) },
  };
}

const scale = (input: Record<string, unknown>, k: string, label: string) => { const v = int(input, k, label); if (v < 1 || v > 5) throw new ValidationError(`${label} ska vara 1–5`); return v; };

export async function addRisk(actor: Actor, input: Record<string, unknown>) {
  await sql`INSERT INTO work_risks ${sql({ company_id: actor.companyId, area: str(input, 'area', { required: true, label: 'Arbetsmoment', max: 150 }), hazard: str(input, 'hazard', { required: true, label: 'Risk', max: 500 }),
    probability: scale(input, 'probability', 'Sannolikhet'), consequence: scale(input, 'consequence', 'Konsekvens'), measure: str(input, 'measure', { max: 500 }), owner: str(input, 'owner', { max: 100 }),
    due_date: date(input, 'due_date', 'Klart senast', false) || null, created_by: actor.userId })}`;
}

export async function riskDone(actor: Actor, id: number) {
  const r = await sql`UPDATE work_risks SET done_on = ${today()} WHERE id = ${id} AND company_id = ${actor.companyId} AND done_on IS NULL`;
  if (!r.count) throw new NotFoundError('Risken');
}

export async function addIncident(actor: Actor, input: Record<string, unknown>) {
  const kind = String(input.kind) as IncidentKind;
  if (!Object.prototype.hasOwnProperty.call(INCIDENTS, kind)) throw new ValidationError('Välj typ av händelse');
  const employeeId = optInt(input, 'employee_id');
  if (employeeId) { const [e] = await sql`SELECT 1 FROM employees WHERE id = ${employeeId} AND company_id = ${actor.companyId}`; if (!e) throw new NotFoundError('Den anställda'); }
  const days = optInt(input, 'days_absent') ?? 0;
  if (days < 0 || days > 3650) throw new ValidationError('Ogiltigt antal sjukdagar');
  const [r] = await sql<{ id: number }[]>`INSERT INTO work_incidents ${sql({ company_id: actor.companyId, date: date(input, 'date', 'Datum'), kind, description: str(input, 'description', { required: true, label: 'Vad hände', max: 2000 }),
    employee_id: employeeId ?? null, days_absent: days, measure: str(input, 'measure', { max: 1000 }), created_by: actor.userId })} RETURNING id`;
  await auditBy(sql, actor, 'work_incident', 'work_incident', r.id, { kind });
  return kind;
}

export async function markReported(actor: Actor, id: number, to: 'av' | 'fk') {
  const d = today();
  const r = to === 'av' ? await sql`UPDATE work_incidents SET reported_av_on = ${d} WHERE id = ${id} AND company_id = ${actor.companyId}`
    : await sql`UPDATE work_incidents SET reported_fk_on = ${d} WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!r.count) throw new NotFoundError('Händelsen');
}

export async function saveReview(actor: Actor, input: Record<string, unknown>) {
  const year = Number(today().slice(0, 4));
  const checked = Object.keys(CHECKLIST).filter((k) => input[`c_${k}`] === 'on');
  const complete = checked.length === Object.keys(CHECKLIST).length;
  await sql`INSERT INTO sam_reviews (company_id, year, checked, note, done_on) VALUES (${actor.companyId}, ${year}, ${checked}, ${str(input, 'note', { max: 2000 })}, ${complete ? today() : null})
    ON CONFLICT (company_id, year) DO UPDATE SET checked = EXCLUDED.checked, note = EXCLUDED.note, done_on = EXCLUDED.done_on`;
  return { done: checked.length, complete };
}
