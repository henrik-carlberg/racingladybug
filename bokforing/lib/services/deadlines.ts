import 'server-only';
import { sql } from '@/lib/db';
import { auditBy } from '@/lib/server/audit';
import { computeDeadlines, type Deadline } from '@/lib/deadlines';
import { addDays, today } from '@/lib/format';
import type { Actor } from './actor';

export interface DeadlineStatus extends Deadline { status: 'done' | 'overdue' | 'soon' | 'upcoming'; doneHow: string | null; href: string }

/** Deadlines för bolaget med status. Förberedelser som appen ser visas via deadlinePrep. */
export async function companyDeadlines(companyId: number, opts: { from?: string; to?: string } = {}): Promise<DeadlineStatus[]> {
  const t = today();
  const [c] = await sql<{ company_type: 'AB' | 'EF'; vat_period: 'month' | 'quarter' | 'year'; f_skatt: boolean; prelskatt_from: string | null; setup: Record<string, unknown>; created: string }[]>`
    SELECT company_type, vat_period, f_skatt, prelskatt_from, setup, to_char(created_at,'YYYY-MM-DD') AS created FROM companies WHERE id = ${companyId}`;
  const fys = await sql<{ id: number; start: string; end: string; closed: boolean }[]>`
    SELECT id, to_char(start_date,'YYYY-MM-DD') AS start, to_char(end_date,'YYYY-MM-DD') AS end, closed FROM fiscal_years WHERE company_id = ${companyId} ORDER BY start_date`;
  const [{ emp }] = await sql<{ emp: number }[]>`SELECT count(*)::int AS emp FROM employees WHERE company_id = ${companyId}`;
  const firstStart = fys[0]?.start ?? t;
  // Deadlines som förföll innan bolaget lades upp i appen visas inte (de har skötts på annat sätt)
  const since = [addDays(t, -365), c.created].sort().pop()!;
  const list = computeDeadlines({
    companyType: c.company_type, vatPeriod: c.vat_period, fSkatt: c.f_skatt, fSkattFrom: c.prelskatt_from ?? firstStart.slice(0, 7), hasEmployees: emp > 0 || c.setup?.has_employees === true,
    fiscalYears: fys.map((f) => ({ start: f.start, end: f.end })),
    from: opts.from ?? since, to: opts.to ?? addDays(t, 300),
  }).filter((d) => !d.periodEnd || d.periodEnd >= firstStart);

  const marks = new Map((await sql<{ key: string; name: string; at: string }[]>`
    SELECT m.key, u.name, to_char(m.done_at,'YYYY-MM-DD') AS at FROM deadline_marks m JOIN users u ON u.id = m.done_by WHERE m.company_id = ${companyId}`).map((m) => [m.key, m]));
  const b = `/c/${companyId}`;
  return list.map((d) => {
    const m = marks.get(d.key);
    // Klart = användaren har bockat av (appen kan inte se att deklarationen faktiskt lämnats in)
    const doneHow: string | null = m ? `Markerad klar av ${m.name} ${m.at}` : null;
    let href = `${b}/deadlines`;
    if (d.kind === 'vat') href = `${b}/rapporter/moms?from=${d.periodStart}&to=${d.periodEnd}`;
    if (d.kind === 'agi') href = `${b}/lon`;
    if (d.kind === 'ink2' || d.kind === 'ink1' || d.kind === 'arsredovisning' || d.kind === 'arsstamma' || d.kind === 'bokslut') {
      const fy = fys.find((f) => f.end === d.periodEnd);
      href = fy ? `${b}/bokslut/${fy.id}` : `${b}/bokslut`;
    }
    const status: DeadlineStatus['status'] = doneHow ? 'done' : d.due < t ? 'overdue' : d.due <= addDays(t, 14) ? 'soon' : 'upcoming';
    return { ...d, status, doneHow, href };
  });
}

/** Förberedelser som appen kan se: t.ex. "momsavräkning bokförd" eller "lön bokförd" (visas som stöd, inte som klart) */
export async function deadlinePrep(companyId: number) {
  const vat = new Set((await sql<{ d: string }[]>`SELECT to_char(date,'YYYY-MM-DD') AS d FROM vouchers v WHERE company_id = ${companyId} AND source_type = 'vat'
    AND NOT EXISTS (SELECT 1 FROM vouchers r WHERE r.corrects_id = v.id)`).map((r) => r.d));
  const payroll = new Set((await sql<{ p: string }[]>`SELECT period AS p FROM payroll_runs WHERE company_id = ${companyId} AND status = 'booked'`).map((r) => r.p));
  const closed = new Set((await sql<{ e: string }[]>`SELECT to_char(end_date,'YYYY-MM-DD') AS e FROM fiscal_years WHERE company_id = ${companyId} AND closed`).map((r) => r.e));
  return { vat, payroll, closed };
}

export async function markDeadline(actor: Actor, key: string, done: boolean) {
  if (!/^[a-z0-9:_-]{3,60}$/.test(key)) throw new Error('Ogiltig deadline');
  if (done) await sql`INSERT INTO deadline_marks (company_id, key, done_by) VALUES (${actor.companyId}, ${key}, ${actor.userId}) ON CONFLICT DO NOTHING`;
  else await sql`DELETE FROM deadline_marks WHERE company_id = ${actor.companyId} AND key = ${key}`;
  await auditBy(sql, actor, done ? 'complete' : 'reopen', 'deadline', null, { key });
}
