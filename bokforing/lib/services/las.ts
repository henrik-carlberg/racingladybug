import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { today } from '@/lib/format';
import { FORMS, MAX_EXEMPT, conversion, priority, seniority, totalDays, type Form, type Period } from '@/lib/las';
import type { Actor } from './actor';
import { date, int, str } from './input';

const FROM_EMPLOYEE: Record<string, Form> = { tillsvidare: 'tillsvidare', visstid: 'sav', provanstallning: 'provanstallning', timanstalld: 'other' };

export async function overview(companyId: number) {
  const t = today();
  const emps = await sql<{ id: number; name: string; personal_number: string; active: boolean; employment_form: string; start: string | null; end: string | null }[]>`
    SELECT id, first_name || ' ' || last_name AS name, personal_number, active, employment_form, to_char(employment_start,'YYYY-MM-DD') AS start, to_char(employment_end,'YYYY-MM-DD') AS end
    FROM employees WHERE company_id = ${companyId} AND (active OR employment_end > ${t}::date - 400) ORDER BY 2`;
  const rows = await sql<{ id: number; employee_id: number; form: Form; start: string; end: string | null; circle: string; shortage: boolean }[]>`SELECT id, employee_id, form, to_char(start_date,'YYYY-MM-DD') AS start, to_char(end_date,'YYYY-MM-DD') AS end, circle, shortage
    FROM employment_periods WHERE company_id = ${companyId} ORDER BY start_date`;
  const exempt = new Set((await sql<{ employee_id: number }[]>`SELECT employee_id FROM las_exemptions WHERE company_id = ${companyId}`).map((x) => x.employee_id));
  const people = emps.map((e) => {
    const own = rows.filter((r) => r.employee_id === e.id);
    // Utan registrerade perioder används anställningen i personalregistret
    const periods: (Period & { id?: number; circle?: string })[] = own.length ? own : e.start ? [{ form: FROM_EMPLOYEE[e.employment_form] ?? 'tillsvidare', start: e.start, end: e.end }] : [];
    const birth = String(e.personal_number).replace(/\D/g, '').slice(0, 8);
    return { id: e.id, name: e.name, active: e.active, birth, periods: own, derived: !own.length, conversion: e.active ? conversion(periods, t) : null, priority: priority(periods, t), days: totalDays(periods, t),
      circle: [...own].reverse().find((p) => p.circle)?.circle || 'Hela bolaget', exempt: exempt.has(e.id) };
  });
  const circles = new Map<string, typeof people>();
  for (const p of people.filter((x) => x.active)) circles.set(p.circle, [...(circles.get(p.circle) ?? []), p]);
  return {
    people, exemptCount: exempt.size,
    alerts: people.filter((p) => p.conversion && (p.conversion.warn || p.conversion.converted)),
    priorities: people.filter((p) => p.priority?.active),
    seniority: [...circles].map(([circle, ps]) => ({ circle, list: seniority(ps) })),
  };
}

const ownEmployee = async (actor: Actor, id: number) => {
  const [e] = await sql`SELECT 1 FROM employees WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!e) throw new NotFoundError('Den anställda');
};

export async function addPeriod(actor: Actor, input: Record<string, unknown>) {
  const employeeId = int(input, 'employee_id', 'Anställd');
  await ownEmployee(actor, employeeId);
  const form = String(input.form) as Form;
  if (!Object.prototype.hasOwnProperty.call(FORMS, form)) throw new ValidationError('Välj anställningsform');
  const start = date(input, 'start_date', 'Från'), end = date(input, 'end_date', 'Till', false) || null;
  if (end && end < start) throw new ValidationError('Perioden slutar före den börjar');
  const [overlap] = await sql`SELECT 1 FROM employment_periods WHERE employee_id = ${employeeId} AND start_date <= ${end ?? '9999-12-31'} AND COALESCE(end_date, '9999-12-31') >= ${start}`;
  if (overlap) throw new ConflictError('Perioden överlappar en annan anställningsperiod');
  await sql`INSERT INTO employment_periods ${sql({ company_id: actor.companyId, employee_id: employeeId, form, start_date: start, end_date: end, circle: str(input, 'circle', { max: 100 }), shortage: input.shortage === 'on', created_by: actor.userId })}`;
  await auditBy(sql, actor, 'employment_period', 'employee', employeeId, { form });
}

export async function removePeriod(actor: Actor, id: number) {
  const r = await sql`DELETE FROM employment_periods WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!r.count) throw new NotFoundError('Perioden');
}

/** Upp till tre arbetstagare får undantas från turordningen (22 §) */
export async function setExempt(actor: Actor, employeeId: number, on: boolean) {
  await ownEmployee(actor, employeeId);
  if (on) {
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM las_exemptions WHERE company_id = ${actor.companyId} AND employee_id <> ${employeeId}`;
    if (n >= MAX_EXEMPT) throw new ValidationError(`Högst ${MAX_EXEMPT} arbetstagare kan undantas från turordningen`);
    await sql`INSERT INTO las_exemptions (company_id, employee_id) VALUES (${actor.companyId}, ${employeeId}) ON CONFLICT DO NOTHING`;
  } else await sql`DELETE FROM las_exemptions WHERE company_id = ${actor.companyId} AND employee_id = ${employeeId}`;
}
