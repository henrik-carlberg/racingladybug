import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { TRAINING_COST, costLines, latest, taxableBenefit, validUntil, validity } from '@/lib/trainings';
import type { Actor } from './actor';
import { date, int, optInt, str } from './input';

type Row = { id: number; employee_id: number; name: string; title: string; kind: 'course' | 'certificate'; provider: string; completed_on: string; valid_until: string | null; cost: number; work_related: boolean; voucher_id: number | null };

export async function overview(companyId: number) {
  const t = today();
  const rows = await sql<Row[]>`SELECT r.id, r.employee_id, e.first_name || ' ' || e.last_name AS name, r.title, r.kind, r.provider, to_char(r.completed_on,'YYYY-MM-DD') AS completed_on, to_char(r.valid_until,'YYYY-MM-DD') AS valid_until,
      r.cost::float8 AS cost, r.work_related, r.voucher_id
    FROM trainings r JOIN employees e ON e.id = r.employee_id WHERE r.company_id = ${companyId} AND e.active ORDER BY r.completed_on DESC, r.id DESC`;
  const current = latest(rows.filter((r) => r.kind === 'certificate')).map((r) => ({ ...r, ...validity(r.valid_until, t) }));
  const year = t.slice(0, 4);
  const perEmployee = new Map<number, { name: string; cost: number; count: number; benefit: number }>();
  for (const r of rows.filter((x) => x.completed_on.startsWith(year))) {
    const p = perEmployee.get(r.employee_id) ?? { name: r.name, cost: 0, count: 0, benefit: 0 };
    p.cost += r.cost; p.count++; p.benefit += taxableBenefit(r.work_related, r.cost); perEmployee.set(r.employee_id, p);
  }
  const employees = await sql<{ id: number; name: string }[]>`SELECT id, first_name || ' ' || last_name AS name FROM employees WHERE company_id = ${companyId} AND active ORDER BY 2`;
  return {
    employees, year, rows,
    certificates: current.sort((a, b) => (a.valid_until ?? '9999').localeCompare(b.valid_until ?? '9999')),
    alerts: current.filter((c) => c.status === 'expired' || c.status === 'expiring'),
    perEmployee: [...perEmployee].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.cost - a.cost),
  };
}

export async function add(actor: Actor, input: Record<string, unknown>) {
  const employeeId = int(input, 'employee_id', 'Anställd');
  const [e] = await sql<{ name: string }[]>`SELECT first_name || ' ' || last_name AS name FROM employees WHERE id = ${employeeId} AND company_id = ${actor.companyId} AND active`;
  if (!e) throw new NotFoundError('Den anställda');
  const kind = input.kind === 'certificate' ? 'certificate' : 'course';
  const completed = date(input, 'completed_on', 'Genomförd');
  const months = optInt(input, 'valid_months');
  if (months != null && (months < 1 || months > 240)) throw new ValidationError('Giltigheten ska vara 1–240 månader');
  const until = date(input, 'valid_until', 'Giltig till', false) || validUntil(completed, months);
  if (until && until <= completed) throw new ValidationError('Giltigheten ska sluta efter genomförandet');
  const cost = String(input.cost ?? '').trim() ? parseAmount(String(input.cost)) : 0;
  if (cost == null || cost < 0) throw new ValidationError('Ogiltig kostnad');
  const workRelated = input.work_related !== 'no';
  const title = str(input, 'title', { required: true, label: 'Utbildning', max: 150 });
  return sql.begin(async (tx) => {
    let voucherId: number | null = null;
    if (cost && input.book === 'on') {
      await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${TRAINING_COST}, 'Utbildning') ON CONFLICT DO NOTHING`;
      voucherId = (await createVoucher(tx, { actor, date: completed > today() ? today() : completed, description: `Utbildning ${title} – ${e.name}`.slice(0, 200), lines: fromSigned(costLines(cost)), sourceType: 'training' })).id;
    }
    const [r] = await tx<{ id: number }[]>`INSERT INTO trainings ${tx({ company_id: actor.companyId, employee_id: employeeId, title, kind, provider: str(input, 'provider', { max: 150 }), completed_on: completed, valid_until: until,
      cost, work_related: workRelated, voucher_id: voucherId, created_by: actor.userId })} RETURNING id`;
    await auditBy(tx, actor, 'training', 'employee', employeeId, { title, cost });
    return { until, benefit: taxableBenefit(workRelated, cost), booked: !!voucherId };
  });
}
