import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { emit } from '@/lib/server/events';
import { formatAmount } from '@/lib/money';
import { today } from '@/lib/format';
import type { Actor } from '@/lib/services/actor';
import { arr, date, int, optInt, str } from '@/lib/services/input';
import { updateEmployee, updatePayslip } from '@/lib/services/payroll';
import { createDocument, sendDocument } from '@/lib/services/documents';
import { flagged, legalSex, levelGroups, payGroups, raiseByPercent, raisePercent, retroAmount, summarize, type PayGroup, type ReviewSummary } from './calc';

export type ReviewStatus = 'planning' | 'approved' | 'applied' | 'cancelled';
export const STATUS_LABEL: Record<ReviewStatus, string> = { planning: 'Planering', approved: 'Godkänd', applied: 'Genomförd', cancelled: 'Avbruten' };

export interface ReviewItem {
  id: number; employee_id: number; employee_name: string; email: string; title: string; department: string;
  current_salary: number; new_salary: number; increase: number; percent: number; comment: string;
  retro_amount: number; retro_paid_run: number | null; document_id: number | null; document_status: string | null;
}
export interface ReviewOut {
  id: number; object: 'salary_review'; name: string; effective_date: string; budget_percent: number; criteria: string; status: ReviewStatus;
  created_by: string; approved_by: string | null; approved_at: string | null; applied_at: string | null;
  items: ReviewItem[]; summary: ReviewSummary;
}

async function load(db: Tx | typeof sql, companyId: number, id: number): Promise<ReviewOut> {
  const [r] = await db<Omit<ReviewOut, 'object' | 'items' | 'summary'>[]>`
    SELECT r.id, r.name, to_char(r.effective_date,'YYYY-MM-DD') AS effective_date, r.budget_percent::float AS budget_percent, r.criteria, r.status,
      u.name AS created_by, a.name AS approved_by, to_char(r.approved_at,'YYYY-MM-DD') AS approved_at, to_char(r.applied_at,'YYYY-MM-DD') AS applied_at
    FROM salary_reviews r JOIN users u ON u.id = r.created_by LEFT JOIN users a ON a.id = r.approved_by
    WHERE r.id = ${id} AND r.company_id = ${companyId}`;
  if (!r) throw new NotFoundError('Lönerevisionen');
  const rows = await db<Omit<ReviewItem, 'increase' | 'percent'>[]>`
    SELECT i.id, i.employee_id, e.first_name || ' ' || e.last_name AS employee_name, e.email, COALESCE(h.title, '') AS title, COALESCE(h.department, '') AS department,
      i.current_salary::int AS current_salary, i.new_salary::int AS new_salary, i.comment, i.retro_amount::int AS retro_amount, i.retro_paid_run,
      i.document_id, d.status AS document_status
    FROM salary_review_items i JOIN employees e ON e.id = i.employee_id LEFT JOIN hr_profiles h ON h.employee_id = e.id
    LEFT JOIN documents d ON d.id = i.document_id
    WHERE i.review_id = ${id} ORDER BY COALESCE(h.department, ''), e.last_name, e.first_name`;
  const items = rows.map((i) => ({ ...i, increase: i.new_salary - i.current_salary, percent: raisePercent(i.current_salary, i.new_salary) }));
  return { ...r, object: 'salary_review', items, summary: summarize(items.map((i) => ({ current: i.current_salary, next: i.new_salary })), r.budget_percent) };
}

export const getReview = (companyId: number, id: number) => load(sql, companyId, id);

export async function listReviews(companyId: number) {
  const ids = await sql<{ id: number }[]>`SELECT id FROM salary_reviews WHERE company_id = ${companyId} ORDER BY effective_date DESC, id DESC`;
  return Promise.all(ids.map((r) => load(sql, companyId, r.id)));
}

/** Skapar en lönerevision med alla aktiva anställda och deras nuvarande lön */
export async function createReview(actor: Actor, input: Record<string, unknown>): Promise<ReviewOut> {
  const effective = date(input, 'effective_date', 'Gäller från');
  const pct = Number(String(input.budget_percent ?? '0').replace(',', '.'));
  if (!Number.isFinite(pct) || pct < 0 || pct > 50) throw new ValidationError('Ange utrymmet i procent, t.ex. 3,0');
  return sql.begin(async (tx) => {
    const [{ id }] = await tx<{ id: number }[]>`INSERT INTO salary_reviews ${tx({
      company_id: actor.companyId, name: str(input, 'name') || `Lönerevision ${effective.slice(0, 4)}`, effective_date: effective,
      budget_percent: pct, criteria: str(input, 'criteria'), created_by: actor.userId,
    })} RETURNING id`;
    const emps = await tx<{ id: number; monthly_salary: number }[]>`SELECT id, monthly_salary::int AS monthly_salary FROM employees
      WHERE company_id = ${actor.companyId} AND active AND monthly_salary > 0 AND (employment_end IS NULL OR employment_end >= ${effective})`;
    if (!emps.length) throw new ValidationError('Det finns inga aktiva anställda med månadslön');
    await tx`INSERT INTO salary_review_items ${tx(emps.map((e) => ({ review_id: id, employee_id: e.id, current_salary: e.monthly_salary, new_salary: e.monthly_salary })))}`;
    await auditBy(tx, actor, 'create', 'salary_review', id);
    return load(tx, actor.companyId, id);
  });
}

async function lockPlanning(tx: Tx, companyId: number, id: number) {
  const [r] = await tx<{ status: ReviewStatus }[]>`SELECT status FROM salary_reviews WHERE id = ${id} AND company_id = ${companyId} FOR UPDATE`;
  if (!r) throw new NotFoundError('Lönerevisionen');
  if (r.status !== 'planning') throw new ConflictError('Lönerevisionen är godkänd och kan inte ändras – återöppna den först');
}

/** Uppdaterar förslag: items = [{ employee_id, new_salary (öre) | percent, comment }] */
export async function saveProposals(actor: Actor, id: number, input: Record<string, unknown>): Promise<ReviewOut> {
  const rows = arr(input, 'items', 'Förslag');
  return sql.begin(async (tx) => {
    await lockPlanning(tx, actor.companyId, id);
    if (input.budget_percent != null && input.budget_percent !== '') {
      const pct = Number(String(input.budget_percent).replace(',', '.'));
      if (!Number.isFinite(pct) || pct < 0 || pct > 50) throw new ValidationError('Ogiltigt utrymme i procent');
      await tx`UPDATE salary_reviews SET budget_percent = ${pct}, criteria = ${input.criteria == null ? tx`criteria` : str(input, 'criteria')} WHERE id = ${id}`;
    }
    for (const r of rows) {
      const emp = int(r, 'employee_id', 'Anställd');
      const [cur] = await tx<{ current_salary: number }[]>`SELECT current_salary::int AS current_salary FROM salary_review_items WHERE review_id = ${id} AND employee_id = ${emp}`;
      if (!cur) throw new ValidationError('Den anställda ingår inte i revisionen');
      let next = optInt(r, 'new_salary', 'Ny lön');
      if (next == null && r.percent != null && r.percent !== '') {
        const p = Number(String(r.percent).replace(',', '.'));
        if (!Number.isFinite(p)) throw new ValidationError('Ogiltig procentsats');
        next = raiseByPercent(cur.current_salary, p);
      }
      if (next != null && next < 0) throw new ValidationError('Lönen kan inte vara negativ');
      await tx`UPDATE salary_review_items SET new_salary = ${next ?? tx`new_salary`}, comment = ${r.comment == null ? tx`comment` : str(r, 'comment')}
        WHERE review_id = ${id} AND employee_id = ${emp}`;
    }
    await auditBy(tx, actor, 'update', 'salary_review', id);
    return load(tx, actor.companyId, id);
  });
}

/** Lägger samma procentuella höjning på alla (utgångspunkt som sedan justeras individuellt) */
export async function applyEvenly(actor: Actor, id: number, percent: number): Promise<ReviewOut> {
  if (!Number.isFinite(percent) || percent < 0 || percent > 50) throw new ValidationError('Ogiltig procentsats');
  return sql.begin(async (tx) => {
    await lockPlanning(tx, actor.companyId, id);
    const items = await tx<{ id: number; current_salary: number }[]>`SELECT id, current_salary::int AS current_salary FROM salary_review_items WHERE review_id = ${id}`;
    for (const i of items) await tx`UPDATE salary_review_items SET new_salary = ${raiseByPercent(i.current_salary, percent)} WHERE id = ${i.id}`;
    await auditBy(tx, actor, 'apply_evenly', 'salary_review', id, { percent });
    return load(tx, actor.companyId, id);
  });
}

/** Ägaren godkänner förslagen. Därefter kan lönebesked skickas och lönerna genomföras. */
export async function approveReview(actor: Actor, id: number): Promise<ReviewOut> {
  if (actor.role !== 'owner') throw new ValidationError('Bara ägaren kan godkänna lönerevisionen');
  return sql.begin(async (tx) => {
    await lockPlanning(tx, actor.companyId, id);
    const [bad] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM salary_review_items WHERE review_id = ${id} AND new_salary < current_salary`;
    if (bad.n) throw new ValidationError(`${bad.n} förslag sänker lönen. En lönesänkning kräver medarbetarens samtycke – justera förslaget först.`);
    await tx`UPDATE salary_reviews SET status = 'approved', approved_by = ${actor.userId}, approved_at = now() WHERE id = ${id}`;
    await auditBy(tx, actor, 'approve', 'salary_review', id);
    const out = await load(tx, actor.companyId, id);
    await emit(tx, actor.companyId, 'lonerevision.approved', out);
    return out;
  });
}

export async function reopenReview(actor: Actor, id: number): Promise<ReviewOut> {
  return sql.begin(async (tx) => {
    const [r] = await tx<{ status: ReviewStatus }[]>`SELECT status FROM salary_reviews WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!r) throw new NotFoundError('Lönerevisionen');
    if (r.status !== 'approved') throw new ConflictError('Bara en godkänd, ej genomförd revision kan återöppnas');
    await tx`UPDATE salary_reviews SET status = 'planning', approved_by = NULL, approved_at = NULL WHERE id = ${id}`;
    await auditBy(tx, actor, 'reopen', 'salary_review', id);
    return load(tx, actor.companyId, id);
  });
}

export async function cancelReview(actor: Actor, id: number) {
  const r = await sql`UPDATE salary_reviews SET status = 'cancelled' WHERE id = ${id} AND company_id = ${actor.companyId} AND status IN ('planning', 'approved') RETURNING id`;
  if (!r.length) throw new ConflictError('Revisionen kan inte avbrytas');
  await auditBy(sql, actor, 'cancel', 'salary_review', id);
  return getReview(actor.companyId, id);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function letterHtml(o: { company: string; name: string; effective: string; current: number; next: number; comment: string; criteria: string }) {
  const diff = o.next - o.current;
  return `<h1>Lönebesked</h1>
<p><b>${esc(o.name)}</b></p>
<p>Efter årets lönerevision får du följande lön från och med <b>${esc(o.effective)}</b>:</p>
<table><tbody>
<tr><td>Nuvarande månadslön</td><td style="text-align:right">${formatAmount(o.current)} kr</td></tr>
<tr><td>Ny månadslön</td><td style="text-align:right"><b>${formatAmount(o.next)} kr</b></td></tr>
<tr><td>Höjning</td><td style="text-align:right">${formatAmount(diff)} kr (${String(raisePercent(o.current, o.next)).replace('.', ',')} %)</td></tr>
</tbody></table>
${o.comment ? `<p><b>Motivering:</b> ${esc(o.comment)}</p>` : ''}
${o.criteria ? `<p><b>Lönekriterier:</b> ${esc(o.criteria)}</p>` : ''}
<p>Övriga anställningsvillkor är oförändrade. Har du frågor om din lön är du välkommen att ta upp dem med din chef.</p>
<p>Signera gärna för att bekräfta att du har tagit del av beskedet.</p>
<p>${esc(o.company)}</p>`;
}

/** Skickar lönebesked till alla som har e-post och ännu inte fått ett, för bekräftelse med e-signering */
export async function sendLetters(actor: Actor, id: number, origin: string): Promise<{ sent: number; missingEmail: string[] }> {
  const r = await getReview(actor.companyId, id);
  if (r.status !== 'approved' && r.status !== 'applied') throw new ConflictError('Godkänn lönerevisionen innan lönebeskeden skickas');
  const [c] = await sql<{ name: string }[]>`SELECT name FROM companies WHERE id = ${actor.companyId}`;
  let sent = 0;
  const missingEmail: string[] = [];
  for (const i of r.items) {
    if (i.document_id) continue;
    if (!i.email) { missingEmail.push(i.employee_name); continue; }
    await sql.begin(async (tx) => {
      const doc = await createDocument(actor, {
        title: `Lönebesked ${r.effective_date.slice(0, 4)} – ${i.employee_name}`, source_module: 'lonerevision', source_id: i.id,
        html: letterHtml({ company: c.name, name: i.employee_name, effective: r.effective_date, current: i.current_salary, next: i.new_salary, comment: i.comment, criteria: r.criteria }),
        signers: [{ name: i.employee_name, email: i.email }],
      }, tx);
      await sendDocument(actor, doc.id, origin, tx);
      await tx`UPDATE salary_review_items SET document_id = ${doc.id} WHERE id = ${i.id}`;
    });
    sent++;
  }
  await auditBy(sql, actor, 'send_letters', 'salary_review', id, { sent });
  return { sent, missingEmail };
}

/** Genomför: nya löner förs över till lönen, lönehistorik sparas och retroaktiv lön räknas fram */
export async function applyReview(actor: Actor, id: number): Promise<ReviewOut> {
  return sql.begin(async (tx) => {
    const [r] = await tx<{ status: ReviewStatus; effective: string }[]>`SELECT status, to_char(effective_date,'YYYY-MM-DD') AS effective FROM salary_reviews
      WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!r) throw new NotFoundError('Lönerevisionen');
    if (r.status !== 'approved') throw new ConflictError('Lönerevisionen måste vara godkänd för att kunna genomföras');
    const items = await tx<{ id: number; employee_id: number; current_salary: number; new_salary: number; comment: string; salary_now: number }[]>`
      SELECT i.id, i.employee_id, i.current_salary::int AS current_salary, i.new_salary::int AS new_salary, i.comment, e.monthly_salary::int AS salary_now
      FROM salary_review_items i JOIN employees e ON e.id = i.employee_id WHERE i.review_id = ${id}`;
    for (const i of items) {
      if (i.new_salary === i.current_salary) continue;
      if (i.salary_now !== i.current_salary && i.salary_now !== i.new_salary) {
        throw new ConflictError('Lönen för en medarbetare har ändrats sedan revisionen skapades. Återöppna revisionen och kontrollera förslaget.');
      }
      const paid = await tx<{ period: string }[]>`SELECT r.period FROM payroll_runs r JOIN payslips p ON p.run_id = r.id
        WHERE r.company_id = ${actor.companyId} AND r.status = 'booked' AND p.employee_id = ${i.employee_id} AND r.period >= ${r.effective.slice(0, 7)}`;
      const retro = retroAmount(i.new_salary - i.current_salary, r.effective, paid.map((p) => p.period));
      await updateEmployee(actor, i.employee_id, { monthly_salary: i.new_salary }, tx);
      await tx`INSERT INTO salary_history ${tx({
        company_id: actor.companyId, employee_id: i.employee_id, effective_date: r.effective, old_salary: i.current_salary, new_salary: i.new_salary,
        review_id: id, comment: i.comment, created_by: actor.userId,
      })}`;
      await tx`UPDATE salary_review_items SET retro_amount = ${retro} WHERE id = ${i.id}`;
    }
    await tx`UPDATE salary_reviews SET status = 'applied', applied_by = ${actor.userId}, applied_at = now() WHERE id = ${id}`;
    await auditBy(tx, actor, 'apply', 'salary_review', id);
    const out = await load(tx, actor.companyId, id);
    await emit(tx, actor.companyId, 'lonerevision.applied', out);
    return out;
  });
}

/** Lägger in retroaktiv lön som lönerad i en lönekörning som inte är bokförd */
export async function addRetroToRun(actor: Actor, id: number, runId: number) {
  const r = await getReview(actor.companyId, id);
  if (r.status !== 'applied') throw new ConflictError('Genomför lönerevisionen först');
  const [run] = await sql<{ status: string; period: string }[]>`SELECT status, period FROM payroll_runs WHERE id = ${runId} AND company_id = ${actor.companyId}`;
  if (!run) throw new NotFoundError('Lönekörningen');
  if (run.status !== 'draft') throw new ConflictError('Lönekörningen är redan bokförd');
  let added = 0;
  for (const i of r.items.filter((x) => x.retro_amount > 0 && !x.retro_paid_run)) {
    const [slip] = await sql<{ id: number; items: { type: string; description: string; amount: number }[] }[]>`
      SELECT id, items FROM payslips WHERE run_id = ${runId} AND employee_id = ${i.employee_id}`;
    if (!slip) continue;
    await updatePayslip(actor, runId, slip.id, {
      items: [...slip.items, { type: 'salary', description: `Retroaktiv lön från ${r.effective_date} (lönerevision)`, amount: i.retro_amount }],
    });
    await sql`UPDATE salary_review_items SET retro_paid_run = ${runId} WHERE id = ${i.id}`;
    added++;
  }
  if (!added) throw new ValidationError('Ingen retroaktiv lön att lägga in för de anställda i lönekörningen');
  await auditBy(sql, actor, 'add_retro', 'salary_review', id, { run: runId, employees: added });
  return { added, period: run.period };
}

/** Underlag för lönekartläggning: löner per befattning (lika arbete) och kravnivå (likvärdigt arbete) med dokumenterad analys */
export async function payMapping(companyId: number) {
  const year = Number(today().slice(0, 4));
  const rows = await sql<{ id: number; name: string; title: string; personal_number: string; salary: number; level: number | null }[]>`
    SELECT e.id, e.first_name || ' ' || e.last_name AS name, COALESCE(NULLIF(h.title, ''), NULLIF(e.title, ''), 'Ingen befattning angiven') AS title, e.personal_number, e.monthly_salary::int AS salary, l.job_level AS level
    FROM employees e LEFT JOIN hr_profiles h ON h.employee_id = e.id LEFT JOIN pay_survey_levels l ON l.employee_id = e.id
    WHERE e.company_id = ${companyId} AND e.active AND e.monthly_salary > 0 ORDER BY 2`;
  const analyses = await sql<{ kind: 'equal' | 'equivalent'; group_key: string; objective: boolean; cause: string; action: string; due_date: string | null }[]>`
    SELECT kind, group_key, objective, cause, action, to_char(due_date,'YYYY-MM-DD') AS due_date FROM pay_survey_analyses WHERE company_id = ${companyId} AND year = ${year}`;
  const people = rows.map((r) => ({ ...r, sex: legalSex(r.personal_number) }));
  const withAnalysis = (kind: 'equal' | 'equivalent', gs: PayGroup[]) => gs.map((g) => ({ ...g, flag: flagged(g), analysis: analyses.find((a) => a.kind === kind && a.group_key === g.group) ?? null }));
  const equal = withAnalysis('equal', payGroups(people.map((r) => ({ group: r.title, sex: r.sex, salary: r.salary }))));
  const equivalent = withAnalysis('equivalent', levelGroups(people));
  const open = [...equal, ...equivalent].filter((g) => g.flag && !g.analysis).length;
  return { year, employees: rows.length, people: people.map(({ personal_number: _p, ...r }) => r), groups: equal, equivalent, open };
}

export async function setLevel(actor: Actor, employeeId: number, input: Record<string, unknown>) {
  const [e] = await sql`SELECT 1 FROM employees WHERE id = ${employeeId} AND company_id = ${actor.companyId}`;
  if (!e) throw new NotFoundError('Medarbetaren');
  const level = Number(input.job_level);
  if (!Number.isInteger(level) || level < 1 || level > 6) throw new ValidationError('Kravnivån ska vara 1–6');
  await sql`INSERT INTO pay_survey_levels (employee_id, company_id, job_level) VALUES (${employeeId}, ${actor.companyId}, ${level}) ON CONFLICT (employee_id) DO UPDATE SET job_level = EXCLUDED.job_level`;
  const title = String(input.title ?? '').trim().slice(0, 100);
  if (title) await sql`UPDATE employees SET title = ${title} WHERE id = ${employeeId} AND company_id = ${actor.companyId}`;
}

/** Analys av en flaggad skillnad: saklig orsak eller åtgärd med tidplan (ska dokumenteras med minst tio anställda) */
export async function saveAnalysis(actor: Actor, input: Record<string, unknown>) {
  const kind = input.kind === 'equivalent' ? 'equivalent' : 'equal';
  const group = String(input.group_key ?? '').trim().slice(0, 150);
  if (!group) throw new ValidationError('Välj grupp');
  const objective = input.objective === 'yes';
  const cause = String(input.cause ?? '').trim().slice(0, 2000);
  if (!cause) throw new ValidationError('Beskriv orsaken till skillnaden');
  const action = String(input.action ?? '').trim().slice(0, 2000);
  const due = String(input.due_date ?? '').trim() || null;
  if (!objective && (!action || !due)) throw new ValidationError('En osaklig skillnad kräver en åtgärd och när den ska vara genomförd (senast inom tre år)');
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new ValidationError('Ogiltigt datum');
  const year = Number(today().slice(0, 4));
  await sql`INSERT INTO pay_survey_analyses (company_id, year, kind, group_key, objective, cause, action, due_date, created_by) VALUES (${actor.companyId}, ${year}, ${kind}, ${group}, ${objective}, ${cause}, ${action}, ${due}, ${actor.userId})
    ON CONFLICT (company_id, year, kind, group_key) DO UPDATE SET objective = EXCLUDED.objective, cause = EXCLUDED.cause, action = EXCLUDED.action, due_date = EXCLUDED.due_date, created_by = EXCLUDED.created_by`;
  await auditBy(sql, actor, 'pay_survey_analysis', 'company', actor.companyId, { kind, objective });
  return objective;
}

export async function salaryHistory(companyId: number, employeeId?: number) {
  return sql<{ employee_id: number; employee_name: string; effective_date: string; old_salary: number; new_salary: number; comment: string; review: string | null }[]>`
    SELECT h.employee_id, e.first_name || ' ' || e.last_name AS employee_name, to_char(h.effective_date,'YYYY-MM-DD') AS effective_date,
      h.old_salary::int AS old_salary, h.new_salary::int AS new_salary, h.comment, r.name AS review
    FROM salary_history h JOIN employees e ON e.id = h.employee_id LEFT JOIN salary_reviews r ON r.id = h.review_id
    WHERE h.company_id = ${companyId} ${employeeId ? sql`AND h.employee_id = ${employeeId}` : sql``}
    ORDER BY h.effective_date DESC, e.last_name LIMIT 200`;
}
