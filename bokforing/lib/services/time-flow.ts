import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { hoursForPayroll, mergeHours, type FlowEntry } from '@/lib/time-flow';
import type { Ctx } from '@/lib/server/auth';
import type { Actor } from './actor';
import { applyHours } from './agreements';
import { date, int } from './input';

export async function setApproval(actor: Actor, on: boolean) {
  await sql`UPDATE companies SET time_approval = ${on} WHERE id = ${actor.companyId}`;
  await auditBy(sql, actor, on ? 'enable' : 'disable', 'time_approval', actor.companyId);
}

/** Tidrapporter per person och period med status */
export async function overview(companyId: number, from: string, to: string) {
  const [c] = await sql<{ on: boolean }[]>`SELECT time_approval AS on FROM companies WHERE id = ${companyId}`;
  const rows = await sql<{ user_id: number; name: string; employee_id: number | null; open: number; approved: number; transferred: number; open_count: number; invoiced: number }[]>`
    SELECT e.user_id, u.name, emp.id AS employee_id,
      COALESCE(SUM(e.minutes) FILTER (WHERE e.status = 'open'), 0)::int AS open,
      COALESCE(SUM(e.minutes) FILTER (WHERE e.status = 'approved' AND e.payslip_id IS NULL), 0)::int AS approved,
      COALESCE(SUM(e.minutes) FILTER (WHERE e.payslip_id IS NOT NULL), 0)::int AS transferred,
      count(*) FILTER (WHERE e.status = 'open')::int AS open_count,
      COALESCE(SUM(e.minutes) FILTER (WHERE e.invoice_id IS NOT NULL), 0)::int AS invoiced
    FROM time_entries e JOIN users u ON u.id = e.user_id LEFT JOIN employees emp ON emp.company_id = e.company_id AND emp.user_id = e.user_id
    WHERE e.company_id = ${companyId} AND e.date BETWEEN ${from} AND ${to} GROUP BY e.user_id, u.name, emp.id ORDER BY u.name`;
  const entries = await sql<(FlowEntry & { id: number; user_id: number; project: string; status: string; payslip_id: number | null })[]>`
    SELECT e.id, e.user_id, to_char(e.date,'YYYY-MM-DD') AS date, e.minutes, to_char(e.start_time,'HH24:MI') AS start_time, to_char(e.end_time,'HH24:MI') AS end_time, e.kind, e.status, e.payslip_id, p.name AS project
    FROM time_entries e JOIN projects p ON p.id = e.project_id WHERE e.company_id = ${companyId} AND e.date BETWEEN ${from} AND ${to} ORDER BY e.date, e.id`;
  return { approval: c?.on ?? false, people: rows.map((r) => ({ ...r, hours: hoursForPayroll(entries.filter((e) => e.user_id === r.user_id && e.status === 'approved' && !e.payslip_id)) })), entries };
}

/** Attest av en persons tid i perioden. Den som attesterar får inte attestera sin egen tid (utom ägaren i ett litet bolag). */
export async function approve(ctx: Ctx, actor: Actor, input: Record<string, unknown>) {
  const userId = int(input, 'user_id', 'Person');
  const from = date(input, 'from', 'Från'), to = date(input, 'to', 'Till');
  if (userId === actor.userId && ctx.role !== 'owner') throw new ForbiddenError('Du kan inte attestera din egen tid');
  const r = await sql`UPDATE time_entries SET status = 'approved', approved_by = ${actor.userId}, approved_at = now()
    WHERE company_id = ${actor.companyId} AND user_id = ${userId} AND status = 'open' AND date BETWEEN ${from} AND ${to} RETURNING id`;
  await auditBy(sql, actor, 'approve', 'time_entry', userId, { from, to, count: r.length });
  return r.length;
}

/** Öppnar attesterad tid igen (bara sådan som inte är fakturerad eller överförd till lönen) */
export async function reopen(actor: Actor, input: Record<string, unknown>) {
  const userId = int(input, 'user_id', 'Person');
  const from = date(input, 'from', 'Från'), to = date(input, 'to', 'Till');
  const r = await sql`UPDATE time_entries SET status = 'open', approved_by = NULL, approved_at = NULL
    WHERE company_id = ${actor.companyId} AND user_id = ${userId} AND status = 'approved' AND payslip_id IS NULL AND invoice_id IS NULL AND date BETWEEN ${from} AND ${to} RETURNING id`;
  await auditBy(sql, actor, 'reopen', 'time_entry', userId, { from, to, count: r.length });
  return r.length;
}

/**
 * Attesterad tid i lönekörningens period förs till lönespecarna: OB, övertid och restid enligt den anställdas kollektivavtal.
 * Tiden markeras som överförd så att den inte kommer med två gånger.
 */
export async function toPayroll(actor: Actor, runId: number) {
  const [run] = await sql<{ period: string; status: string }[]>`SELECT period, status FROM payroll_runs WHERE id = ${runId} AND company_id = ${actor.companyId}`;
  if (!run) throw new NotFoundError('Lönekörningen');
  if (run.status !== 'draft') throw new ConflictError('Lönekörningen är redan bokförd');
  const [y, m] = run.period.split('-').map(Number);
  const from = `${run.period}-01`, to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const slips = await sql<{ id: number; user_id: number | null; hours: Record<string, number>; agreement_id: number | null; name: string }[]>`
    SELECT p.id, e.user_id, p.hours, e.agreement_id, e.first_name || ' ' || e.last_name AS name FROM payslips p JOIN employees e ON e.id = p.employee_id WHERE p.run_id = ${runId}`;
  let moved = 0;
  const skipped: string[] = [];
  for (const s of slips) {
    if (!s.user_id) continue;
    if (!s.agreement_id) {
      const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM time_entries WHERE company_id = ${actor.companyId} AND user_id = ${s.user_id} AND status = 'approved' AND payslip_id IS NULL AND date BETWEEN ${from} AND ${to}`;
      if (n) skipped.push(s.name);
      continue;
    }
    // Tiden tas i anspråk först (atomiskt) så att två samtidiga överföringar inte lägger in samma timmar två gånger
    const es = await sql<(FlowEntry & { id: number })[]>`UPDATE time_entries SET payslip_id = ${s.id}
      WHERE company_id = ${actor.companyId} AND user_id = ${s.user_id} AND status = 'approved' AND payslip_id IS NULL AND date BETWEEN ${from} AND ${to}
      RETURNING id, to_char(date,'YYYY-MM-DD') AS date, minutes, to_char(start_time,'HH24:MI') AS start_time, to_char(end_time,'HH24:MI') AS end_time, kind`;
    if (!es.length) continue;
    try {
      const [cur] = await sql<{ hours: Record<string, number> }[]>`SELECT hours FROM payslips WHERE id = ${s.id}`;
      const merged = mergeHours(cur?.hours ?? {}, hoursForPayroll(es));
      await applyHours(actor, runId, s.id, Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, String(v)])));
    } catch (e) {
      await sql`UPDATE time_entries SET payslip_id = NULL WHERE id IN ${sql(es.map((x) => x.id))}`;
      throw e;
    }
    moved += es.length;
  }
  await auditBy(sql, actor, 'time_to_payroll', 'payroll_run', runId, { moved, skipped });
  if (!moved && !skipped.length) throw new ValidationError('Det finns ingen attesterad tid i perioden att föra över');
  return { moved, skipped };
}

export async function draftRuns(companyId: number) {
  return sql<{ id: number; period: string }[]>`SELECT id, period FROM payroll_runs WHERE company_id = ${companyId} AND status = 'draft' ORDER BY period DESC`;
}
