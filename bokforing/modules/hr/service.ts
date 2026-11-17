import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { emit } from '@/lib/server/events';
import { addDays } from '@/lib/format';
import { formatAmount } from '@/lib/money';
import type { Actor } from '@/lib/services/actor';
import { bool, date, int, optInt, str } from '@/lib/services/input';
import { createEmployee, getEmployee, updateEmployee } from '@/lib/services/payroll';
import { createDocument, sendDocument } from '@/lib/services/documents';
import { CHECKLISTS, employmentContract, termsChange, terminationConfirmation, PROCESS_LABEL, type ProcessType } from './templates';

export interface TaskOut { id: number; position: number; title: string; responsible: string; due_date: string | null; auto_key: string | null; done: boolean; done_by: string | null; done_at: string | null }
export interface ProcessOut {
  id: number; object: 'hr.process'; type: ProcessType; type_label: string; status: 'open' | 'completed' | 'cancelled'; employee_id: number; employee_name: string;
  effective_date: string; data: Record<string, unknown>; document_id: number | null; document_status: string | null; created_by: string; created_at: string;
  completed_at: string | null; tasks: TaskOut[]; progress: { done: number; total: number };
}
export interface ProfileOut { employee_id: number; title: string; department: string; manager_employee_id: number | null; manager_name: string | null; employment_type: string; phone: string; emergency_contact: string }

async function fetchProcess(db: Tx | typeof sql, companyId: number, id: number): Promise<ProcessOut> {
  const [p] = await db<Omit<ProcessOut, 'tasks' | 'progress' | 'object' | 'type_label'>[]>`
    SELECT p.id, p.type, p.status, p.employee_id, e.first_name || ' ' || e.last_name AS employee_name, to_char(p.effective_date,'YYYY-MM-DD') AS effective_date,
      p.data, p.document_id, d.status AS document_status, u.name AS created_by, p.created_at, p.completed_at
    FROM hr_processes p JOIN employees e ON e.id = p.employee_id JOIN users u ON u.id = p.created_by LEFT JOIN documents d ON d.id = p.document_id
    WHERE p.id = ${id} AND p.company_id = ${companyId}`;
  if (!p) throw new NotFoundError('Processen');
  const tasks = await db<TaskOut[]>`
    SELECT t.id, t.position, t.title, t.responsible, to_char(t.due_date,'YYYY-MM-DD') AS due_date, t.auto_key, t.done, u.name AS done_by,
      to_char(t.done_at AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD HH24:MI') AS done_at
    FROM hr_tasks t LEFT JOIN users u ON u.id = t.done_by WHERE t.process_id = ${id} ORDER BY t.position`;
  return { ...p, object: 'hr.process', type_label: PROCESS_LABEL[p.type], tasks: [...tasks], progress: { done: tasks.filter((t) => t.done).length, total: tasks.length } };
}
export const getProcess = (companyId: number, id: number) => fetchProcess(sql, companyId, id);

export async function listProcesses(companyId: number, f: { status?: string; employee_id?: number } = {}) {
  const rows = await sql<{ id: number }[]>`SELECT id FROM hr_processes WHERE company_id = ${companyId}
    ${f.status ? sql`AND status = ${f.status}` : sql``} ${f.employee_id ? sql`AND employee_id = ${f.employee_id}` : sql``} ORDER BY effective_date DESC, id DESC LIMIT 500`;
  return Promise.all(rows.map((r) => getProcess(companyId, r.id)));
}

export async function getProfile(companyId: number, employeeId: number): Promise<ProfileOut> {
  const [p] = await sql<ProfileOut[]>`
    SELECT e.id AS employee_id, COALESCE(h.title,'') AS title, COALESCE(h.department,'') AS department, h.manager_employee_id,
      m.first_name || ' ' || m.last_name AS manager_name, COALESCE(h.employment_type,'tillsvidare') AS employment_type,
      COALESCE(h.phone,'') AS phone, COALESCE(h.emergency_contact,'') AS emergency_contact
    FROM employees e LEFT JOIN hr_profiles h ON h.employee_id = e.id LEFT JOIN employees m ON m.id = h.manager_employee_id
    WHERE e.id = ${employeeId} AND e.company_id = ${companyId}`;
  if (!p) throw new NotFoundError('Den anställda');
  return p;
}

async function upsertProfile(db: Tx | typeof sql, companyId: number, employeeId: number, f: Partial<Omit<ProfileOut, 'employee_id' | 'manager_name'>>) {
  if (f.manager_employee_id) {
    const m = await db`SELECT 1 FROM employees WHERE id = ${f.manager_employee_id} AND company_id = ${companyId}`;
    if (!m.length) throw new ValidationError('Chefen finns inte bland de anställda');
    if (f.manager_employee_id === employeeId) throw new ValidationError('En anställd kan inte vara sin egen chef');
  }
  const cols = { employee_id: employeeId, company_id: companyId, ...f, updated_at: new Date() };
  await db`INSERT INTO hr_profiles ${db(cols)} ON CONFLICT (employee_id) DO UPDATE SET ${db(Object.fromEntries(Object.entries(cols).filter(([k]) => k !== 'employee_id')))}`;
}

export async function updateProfile(actor: Actor, employeeId: number, input: Record<string, unknown>) {
  await getEmployee(actor.companyId, employeeId);
  const f: Record<string, unknown> = {};
  for (const k of ['title', 'department', 'employment_type', 'phone', 'emergency_contact']) if (k in input) f[k] = str(input, k);
  if ('manager_employee_id' in input) f.manager_employee_id = optInt(input, 'manager_employee_id', 'Chef');
  await upsertProfile(sql, actor.companyId, employeeId, f);
  await auditBy(sql, actor, 'update', 'hr.profile', employeeId, Object.keys(f));
  return getProfile(actor.companyId, employeeId);
}

async function companyParty(db: Tx | typeof sql, companyId: number) {
  const [c] = await db<{ name: string; orgnr: string; address: string; postal_code: string; city: string }[]>`SELECT name, orgnr, address, postal_code, city FROM companies WHERE id = ${companyId}`;
  return { name: c.name, orgnr: c.orgnr, address: [c.address, `${c.postal_code} ${c.city}`.trim()].filter(Boolean).join(', ') };
}

async function createProcess(tx: Tx, actor: Actor, type: ProcessType, employeeId: number, effective: string, data: Record<string, unknown>, documentId: number | null) {
  const [p] = await tx<{ id: number }[]>`INSERT INTO hr_processes (company_id, employee_id, type, effective_date, data, document_id, created_by)
    VALUES (${actor.companyId}, ${employeeId}, ${type}, ${effective}, ${tx.json(data as never)}, ${documentId}, ${actor.userId}) RETURNING id`;
  const tasks = CHECKLISTS[type].filter((t) => documentId || t.autoKey !== 'document_signed');
  await tx`INSERT INTO hr_tasks ${tx(tasks.map((t, i) => ({
    process_id: p.id, position: i + 1, title: t.title, responsible: t.responsible, due_date: addDays(effective, t.offsetDays), auto_key: t.autoKey ?? null,
  })))}`;
  if (documentId) await tx`UPDATE documents SET source_module = 'hr', source_id = ${p.id} WHERE id = ${documentId}`;
  await auditBy(tx, actor, 'create', 'hr.process', p.id, { type, employee_id: employeeId });
  const out = await fetchProcess(tx, actor.companyId, p.id);
  await emit(tx, actor.companyId, 'hr.process.created', out);
  return out;
}

/** Signerare på arbetsgivarsidan (inloggad användare) och den anställda (extern länk) */
async function signers(tx: Tx, actor: Actor, employee: { name: string; email: string }) {
  const [u] = await tx<{ id: number; name: string }[]>`SELECT id, name FROM users WHERE id = ${actor.userId}`;
  if (!employee.email) throw new ValidationError('Den anställdas e-post krävs för att skicka avtalet för signering');
  return [{ user_id: u.id, name: u.name }, { name: employee.name, email: employee.email }];
}

const assertOpen = async (tx: Tx, companyId: number, employeeId: number, type?: ProcessType) => {
  const open = await tx`SELECT 1 FROM hr_processes WHERE company_id = ${companyId} AND employee_id = ${employeeId} AND status = 'open' ${type ? tx`AND type = ${type}` : tx``}`;
  if (open.length) throw new ConflictError('Det finns redan en pågående process för den anställda');
};

// ---------- Onboarding ----------

export async function startOnboarding(actor: Actor, input: Record<string, unknown>, origin: string): Promise<ProcessOut> {
  const start = date(input, 'employment_start', 'Startdatum');
  const sendContract = !('send_contract' in input) || bool(input, 'send_contract');
  const employmentType = str(input, 'employment_type') || 'tillsvidare';
  const end = date(input, 'employment_end', 'Slutdatum', employmentType === 'visstid');
  return sql.begin(async (tx) => {
    // Den anställda läggs upp inaktiv – aktiveras i lönen när onboardingen slutförs
    const e = await createEmployee(actor, { ...input, employment_start: start, employment_end: end || '', active: false }, tx);
    const name = `${e.first_name} ${e.last_name}`;
    const profile = { title: str(input, 'title', { required: true, label: 'Befattning' }), department: str(input, 'department'), employment_type: employmentType,
      manager_employee_id: optInt(input, 'manager_employee_id', 'Chef'), phone: str(input, 'phone') };
    await upsertProfile(tx, actor.companyId, e.id, profile);
    let documentId: number | null = null;
    if (sendContract) {
      const html = employmentContract({
        employer: await companyParty(tx, actor.companyId),
        employee: { name, personal_number: e.personal_number, address: [e.address, `${e.postal_code} ${e.city}`.trim()].filter(Boolean).join(', ') },
        title: profile.title, department: profile.department, start, employmentType, end: end || undefined, salary: e.monthly_salary,
        hours: str(input, 'working_hours') || 'Heltid, 40 timmar per vecka, förlagd måndag–fredag.',
        workplace: str(input, 'workplace'), vacationDays: optInt(input, 'vacation_days') ?? 25,
        noticeText: str(input, 'notice_text') || 'Uppsägningstid enligt lagen om anställningsskydd (LAS), om inte annat följer av kollektivavtal. Under provanställning gäller 14 dagars underrättelsetid.',
        collectiveAgreement: str(input, 'collective_agreement'), pension: str(input, 'pension') || 'Tjänstepension enligt arbetsgivarens pensionspolicy.', other: str(input, 'other'),
      });
      const doc = await createDocument(actor, { title: `Anställningsavtal – ${name}`, html, signers: await signers(tx, actor, { name, email: e.email }),
        message: `Välkommen! Granska och signera ditt anställningsavtal.` }, tx);
      await sendDocument(actor, doc.id, origin, tx);
      documentId = doc.id;
    }
    return createProcess(tx, actor, 'onboarding', e.id, start, { title: profile.title, department: profile.department, employment_type: employmentType }, documentId);
  });
}

// ---------- Förflyttning (ändrade villkor) ----------

export async function startMove(actor: Actor, input: Record<string, unknown>, origin: string): Promise<ProcessOut> {
  const employeeId = int(input, 'employee_id', 'Anställd');
  const effective = date(input, 'effective_date', 'Gäller från');
  const e = await getEmployee(actor.companyId, employeeId);
  const cur = await getProfile(actor.companyId, employeeId);
  const newSalary = optInt(input, 'new_monthly_salary', 'Ny månadslön');
  const data: Record<string, unknown> = {
    new_title: str(input, 'new_title') || null, new_department: str(input, 'new_department') || null,
    new_manager_employee_id: optInt(input, 'new_manager_employee_id'), new_monthly_salary: newSalary, reason: str(input, 'reason'),
    previous: { title: cur.title, department: cur.department, manager_employee_id: cur.manager_employee_id, monthly_salary: e.monthly_salary },
  };
  const changes: { label: string; from: string; to: string }[] = [];
  if (data.new_title && data.new_title !== cur.title) changes.push({ label: 'Befattning', from: cur.title || '–', to: String(data.new_title) });
  if (data.new_department && data.new_department !== cur.department) changes.push({ label: 'Avdelning', from: cur.department || '–', to: String(data.new_department) });
  if (newSalary != null && newSalary !== e.monthly_salary) changes.push({ label: 'Månadslön', from: `${formatAmount(e.monthly_salary)} kr`, to: `${formatAmount(newSalary)} kr` });
  if (data.new_manager_employee_id && data.new_manager_employee_id !== cur.manager_employee_id) {
    const [m] = await sql<{ n: string }[]>`SELECT first_name || ' ' || last_name AS n FROM employees WHERE id = ${data.new_manager_employee_id as number} AND company_id = ${actor.companyId}`;
    if (!m) throw new ValidationError('Chefen finns inte');
    changes.push({ label: 'Närmaste chef', from: cur.manager_name ?? '–', to: m.n });
  }
  if (changes.length === 0) throw new ValidationError('Ange minst en ändring (befattning, avdelning, chef eller lön)');
  const send = !('send_document' in input) || bool(input, 'send_document');
  return sql.begin(async (tx) => {
    await assertOpen(tx, actor.companyId, employeeId, 'move');
    let documentId: number | null = null;
    if (send) {
      const name = `${e.first_name} ${e.last_name}`;
      const doc = await createDocument(actor, { title: `Ändring av anställningsvillkor – ${name}`,
        html: termsChange({ employer: await companyParty(tx, actor.companyId), employee: { name, personal_number: e.personal_number, address: '' }, effective, changes, reason: String(data.reason ?? '') }),
        signers: await signers(tx, actor, { name, email: e.email }) }, tx);
      await sendDocument(actor, doc.id, origin, tx);
      documentId = doc.id;
    }
    return createProcess(tx, actor, 'move', employeeId, effective, { ...data, changes }, documentId);
  });
}

// ---------- Offboarding ----------

export async function startOffboarding(actor: Actor, input: Record<string, unknown>, origin: string): Promise<ProcessOut> {
  const employeeId = int(input, 'employee_id', 'Anställd');
  const lastDay = date(input, 'last_day', 'Sista anställningsdag');
  const reason = str(input, 'reason', { required: true, label: 'Orsak' });
  const noticeDate = date(input, 'notice_date', 'Datum för besked', false) || new Date().toISOString().slice(0, 10);
  const e = await getEmployee(actor.companyId, employeeId);
  const send = !('send_document' in input) || bool(input, 'send_document');
  return sql.begin(async (tx) => {
    await assertOpen(tx, actor.companyId, employeeId, 'offboarding');
    let documentId: number | null = null;
    const name = `${e.first_name} ${e.last_name}`;
    if (send) {
      const doc = await createDocument(actor, { title: `Bekräftelse av anställningens upphörande – ${name}`,
        html: terminationConfirmation({ employer: await companyParty(tx, actor.companyId), employee: { name, personal_number: e.personal_number, address: '' },
          lastDay, noticeDate, reason, notes: str(input, 'notes') }),
        signers: await signers(tx, actor, { name, email: e.email }) }, tx);
      await sendDocument(actor, doc.id, origin, tx);
      documentId = doc.id;
    }
    return createProcess(tx, actor, 'offboarding', employeeId, lastDay, { reason, notice_date: noticeDate, notes: str(input, 'notes') }, documentId);
  });
}

// ---------- Uppgifter och slutförande ----------

export async function setTaskDone(actor: Actor, processId: number, taskId: number, done: boolean) {
  return sql.begin(async (tx) => {
    const p = await fetchProcess(tx, actor.companyId, processId);
    if (p.status !== 'open') throw new ConflictError('Processen är avslutad');
    const t = p.tasks.find((x) => x.id === taskId);
    if (!t) throw new NotFoundError('Uppgiften');
    if (t.auto_key === 'document_signed') throw new ValidationError('Uppgiften bockas av automatiskt när dokumentet är signerat');
    await tx`UPDATE hr_tasks SET done = ${done}, done_by = ${done ? actor.userId : null}, done_at = ${done ? new Date() : null} WHERE id = ${taskId}`;
    await auditBy(tx, actor, done ? 'complete' : 'reopen', 'hr.task', taskId, { process: processId });
    return fetchProcess(tx, actor.companyId, processId);
  });
}

/**
 * Slutför processen och för över ändringarna:
 *  - onboarding: den anställda aktiveras i lönen
 *  - förflyttning: ny lön, befattning, avdelning och chef
 *  - offboarding: sista anställningsdag sätts (den anställda tas med i lönekörningar t.o.m. den månaden)
 */
export async function completeProcess(actor: Actor, processId: number, input: Record<string, unknown> = {}) {
  return sql.begin(async (tx) => {
    const p = await fetchProcess(tx, actor.companyId, processId);
    if (p.status !== 'open') throw new ConflictError('Processen är redan avslutad');
    const open = p.tasks.filter((t) => !t.done);
    if (open.length && !bool(input, 'force')) throw new ValidationError(`${open.length} uppgift(er) är inte klara: ${open.map((t) => t.title).join('; ')}`);
    if (p.document_id && p.document_status !== 'completed' && !bool(input, 'force')) throw new ValidationError('Dokumentet är inte signerat av alla parter ännu');
    const d = p.data as Record<string, unknown>;
    if (p.type === 'onboarding') {
      await updateEmployee(actor, p.employee_id, { active: true }, tx);
    } else if (p.type === 'move') {
      if (d.new_monthly_salary != null) await updateEmployee(actor, p.employee_id, { monthly_salary: d.new_monthly_salary }, tx);
      const f: Record<string, unknown> = {};
      if (d.new_title) f.title = d.new_title;
      if (d.new_department) f.department = d.new_department;
      if (d.new_manager_employee_id) f.manager_employee_id = d.new_manager_employee_id;
      if (Object.keys(f).length) await upsertProfile(tx, actor.companyId, p.employee_id, f);
    } else {
      await updateEmployee(actor, p.employee_id, { employment_end: p.effective_date }, tx);
    }
    await tx`UPDATE hr_processes SET status = 'completed', completed_by = ${actor.userId}, completed_at = now() WHERE id = ${processId}`;
    await auditBy(tx, actor, 'complete', 'hr.process', processId, { forced: open.length > 0 });
    const out = await fetchProcess(tx, actor.companyId, processId);
    await emit(tx, actor.companyId, 'hr.process.completed', out);
    return out;
  });
}

export async function cancelProcess(actor: Actor, processId: number) {
  return sql.begin(async (tx) => {
    const r = await tx`UPDATE hr_processes SET status = 'cancelled' WHERE id = ${processId} AND company_id = ${actor.companyId} AND status = 'open' RETURNING document_id`;
    if (!r.length) throw new ConflictError('Endast pågående processer kan avbrytas');
    if (r[0].document_id) await tx`UPDATE documents SET status = 'cancelled' WHERE id = ${r[0].document_id} AND status IN ('draft','pending')`;
    await auditBy(tx, actor, 'cancel', 'hr.process', processId);
    return fetchProcess(tx, actor.companyId, processId);
  });
}

/** Lyssnare: bocka av "signerat"-uppgiften när processens dokument är klart */
export async function onDocumentCompleted(tx: Tx, companyId: number, documentId: number) {
  await tx`UPDATE hr_tasks t SET done = true, done_at = now() FROM hr_processes p
    WHERE p.id = t.process_id AND p.company_id = ${companyId} AND p.document_id = ${documentId} AND t.auto_key = 'document_signed' AND NOT t.done`;
}
