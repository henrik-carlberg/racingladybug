import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { recomputeSlip } from '@/lib/server/payroll';
import { today } from '@/lib/format';
import { earnedDays, finalPay } from '@/lib/final-pay';
import type { PayItem } from '@/lib/payroll';
import type { Actor } from './actor';
import { vacationBalances } from './absence';
import { date, int, str } from './input';

const num = (v: unknown, label: string) => { const n = Number(String(v ?? '0').replace(',', '.').trim() || '0'); if (!Number.isFinite(n) || n < 0 || n > 400) throw new ValidationError(`Ange ${label} som antal dagar`); return Math.round(n * 10) / 10; };

/** Förslag till slutlön för en anställd: semestersaldo, intjänade dagar och belopp */
export async function proposal(companyId: number, employeeId: number, end: string) {
  const [e] = await sql<{ id: number; name: string; monthly: number; start: string | null; vacation_days: number; rule: 'same' | 'percent'; active: boolean }[]>`SELECT id, first_name || ' ' || last_name AS name,
    monthly_salary::float8 AS monthly, to_char(employment_start,'YYYY-MM-DD') AS start, vacation_days, vacation_rule AS rule, active FROM employees WHERE id = ${employeeId} AND company_id = ${companyId}`;
  if (!e) throw new NotFoundError('Den anställda');
  const bal = (await vacationBalances(companyId, Number(end.slice(0, 4)))).find((b) => b.id === employeeId);
  const runs = await sql<{ id: number; period: string }[]>`SELECT r.id, r.period FROM payroll_runs r JOIN payslips p ON p.run_id = r.id AND p.employee_id = ${employeeId}
    WHERE r.company_id = ${companyId} AND r.status = 'draft' ORDER BY r.period`;
  const [done] = await sql<{ end_date: string; vacation: number; salary: number; advance: number }[]>`SELECT to_char(end_date,'YYYY-MM-DD') AS end_date, vacation::float8 AS vacation, salary::float8 AS salary, advance::float8 AS advance FROM final_pays WHERE employee_id = ${employeeId}`;
  return { employee: e, unused: Math.max(0, bal?.left ?? 0), advance: Math.max(0, -(bal?.left ?? 0)), earned: earnedDays({ end, start: e.start, perYear: e.vacation_days }), runs, done: done ?? null };
}

/** Lägger slutlönen på den anställdas lönespec i en lönekörning som inte är bokförd och avslutar anställningen */
export async function apply(actor: Actor, employeeId: number, input: Record<string, unknown>) {
  const end = date(input, 'end', 'Sista anställningsdag');
  const runId = int(input, 'run_id', 'Lönekörning');
  const ownResignation = str(input, 'reason') === 'egen';
  return sql.begin(async (tx) => {
    const [e] = await tx<{ monthly: number; rule: 'same' | 'percent'; start: string | null }[]>`SELECT monthly_salary::float8 AS monthly, vacation_rule AS rule, to_char(employment_start,'YYYY-MM-DD') AS start
      FROM employees WHERE id = ${employeeId} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!e) throw new NotFoundError('Den anställda');
    if (e.start && end < e.start) throw new ValidationError('Slutdagen ligger före anställningens början');
    const [dup] = await tx`SELECT 1 FROM final_pays WHERE employee_id = ${employeeId}`;
    if (dup) throw new ConflictError('Slutlönen är redan beräknad');
    const [run] = await tx<{ status: string; period: string }[]>`SELECT status, period FROM payroll_runs WHERE id = ${runId} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!run) throw new NotFoundError('Lönekörningen');
    if (run.status !== 'draft') throw new ConflictError('Lönekörningen är redan bokförd');
    if (run.period < end.slice(0, 7)) throw new ValidationError('Slutlönen betalas tidigast i lönekörningen för slutmånaden');
    const [slip] = await tx<{ id: number; items: PayItem[] }[]>`SELECT id, items FROM payslips WHERE run_id = ${runId} AND employee_id = ${employeeId} FOR UPDATE`;
    if (!slip) throw new ValidationError('Den anställda finns inte med i lönekörningen');
    const earnedPay = str(input, 'earned_pay') ? Number(str(input, 'earned_pay').replace(/\s/g, '').replace(',', '.')) * 100 : undefined;
    const r = finalPay({ monthly: e.monthly, end, unusedDays: num(input.unused_days, 'outtagna dagar'), savedDays: num(input.saved_days, 'sparade dagar'), earnedDays: num(input.earned_days, 'intjänade dagar'),
      advanceDays: num(input.advance_days, 'förskottsdagar'), rule: e.rule, earnedPay, ownResignation });
    // Ordinarie månadslön ersätts av slutlönens rader; övriga rader (tillägg, förmåner, avdrag) behålls
    let replaced = false;
    const rest = slip.items.filter((i) => { if (!replaced && i.type === 'salary' && !i.code && Number(i.amount) === e.monthly) { replaced = true; return false; } return true; });
    await tx`UPDATE payslips SET items = ${tx.json([...r.items, ...rest] as never)} WHERE id = ${slip.id}`;
    await recomputeSlip(tx, slip.id);
    await tx`UPDATE employees SET employment_end = ${end}, active = false WHERE id = ${employeeId}`;
    await tx`INSERT INTO final_pays ${tx({ employee_id: employeeId, company_id: actor.companyId, run_id: runId, end_date: end, reason: ownResignation ? 'egen' : str(input, 'reason') || 'arbetsgivare',
      salary: r.salary, vacation: r.vacation, vacation_days: r.days, advance: r.advance, created_by: actor.userId })}`;
    await auditBy(tx, actor, 'final_pay', 'employee', employeeId, { end, gross: r.gross });
    return r;
  });
}
export const defaultEnd = () => today();
