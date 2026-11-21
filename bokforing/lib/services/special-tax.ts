import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { validate, type SpecialKind } from '@/lib/special-tax';
import type { Actor } from './actor';
import { date, str } from './input';

export async function list(companyId: number) {
  return sql<{ id: number; name: string; kind: SpecialKind | null; decision: string; valid_from: string | null; valid_to: string | null }[]>`
    SELECT e.id, e.first_name || ' ' || e.last_name AS name, t.kind, COALESCE(t.decision, '') AS decision, to_char(t.valid_from,'YYYY-MM-DD') AS valid_from, to_char(t.valid_to,'YYYY-MM-DD') AS valid_to
    FROM employees e LEFT JOIN employee_special_tax t ON t.employee_id = e.id WHERE e.company_id = ${companyId} AND e.active ORDER BY e.first_name, e.last_name`;
}

/** Sparar Skatteverkets (eller Forskarskattenämndens) beslut – gäller lönespecar med utbetalning inom giltighetstiden */
export async function save(actor: Actor, employeeId: number, input: Record<string, unknown>) {
  const [e] = await sql`SELECT 1 FROM employees WHERE id = ${employeeId} AND company_id = ${actor.companyId}`;
  if (!e) throw new NotFoundError('Den anställda');
  const kind = str(input, 'kind');
  if (!kind) {
    await sql`DELETE FROM employee_special_tax WHERE employee_id = ${employeeId} AND company_id = ${actor.companyId}`;
    await auditBy(sql, actor, 'special_tax_removed', 'employee', employeeId);
    return;
  }
  if (kind !== 'expert' && kind !== 'sink') throw new ValidationError('Välj expertskatt eller SINK');
  const from = date(input, 'valid_from', 'Gäller från'), to = date(input, 'valid_to', 'Gäller till');
  const err = validate(kind, from, to);
  if (err) throw new ValidationError(err);
  const decision = str(input, 'decision', { required: true, label: 'Beslutets nummer eller datum', max: 100 });
  await sql`INSERT INTO employee_special_tax ${sql({ employee_id: employeeId, company_id: actor.companyId, kind, decision, valid_from: from, valid_to: to, updated_by: actor.userId })}
    ON CONFLICT (employee_id) DO UPDATE SET kind = EXCLUDED.kind, decision = EXCLUDED.decision, valid_from = EXCLUDED.valid_from, valid_to = EXCLUDED.valid_to, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  await auditBy(sql, actor, 'special_tax', 'employee', employeeId, { kind, from, to });
}
