import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { createVoucher } from '@/lib/server/ledger';
import { auditBy } from '@/lib/server/audit';
import { emit } from '@/lib/server/events';
import { recomputeSlip } from '@/lib/server/payroll';
import { payrollBookingLines, type PayItem, type PayItemType } from '@/lib/payroll';
import { buildAgiXml } from '@/lib/agi';
import { agiId, normalizePersonalNumber } from '@/lib/validate';
import type { Actor } from './actor';
import { arr, bool, date, has, int, list, optInt, str, type Page } from './input';

// ---------- Anställda ----------

export interface EmployeeOut {
  id: number; object: 'employee'; first_name: string; last_name: string; personal_number: string; email: string;
  address: string; postal_code: string; city: string; bank_clearing: string; bank_account: string;
  employment_start: string | null; employment_end: string | null; monthly_salary: number;
  tax_mode: 'table' | 'percent'; tax_table: number | null; tax_column: number; tax_percent: number | null;
  fee_override: number | null; active: boolean; created_at: string;
}

const ECOLS = () => sql`id, 'employee' AS object, first_name, last_name, personal_number, email, address, postal_code, city,
  bank_clearing, bank_account, to_char(employment_start,'YYYY-MM-DD') AS employment_start, to_char(employment_end,'YYYY-MM-DD') AS employment_end,
  monthly_salary, tax_mode, tax_table, tax_column, tax_percent::float8 AS tax_percent, fee_override::float8 AS fee_override, active, created_at`;

export async function getEmployee(companyId: number, id: number): Promise<EmployeeOut> {
  const [e] = await sql<EmployeeOut[]>`SELECT ${ECOLS()} FROM employees WHERE id = ${id} AND company_id = ${companyId}`;
  if (!e) throw new NotFoundError('Den anställda');
  return e;
}

export async function listEmployees(companyId: number, p: Page) {
  const rows = await sql<EmployeeOut[]>`SELECT ${ECOLS()} FROM employees WHERE company_id = ${companyId}
    ${p.startingAfter ? sql`AND id > ${p.startingAfter}` : sql``} ORDER BY id LIMIT ${p.limit + 1}`;
  return list([...rows], p);
}

function num(input: Record<string, unknown>, k: string, label: string): number | null {
  const v = input[k];
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) throw new ValidationError(`${label} måste vara ett tal`);
  return n;
}

function readEmployee(input: Record<string, unknown>, cur?: EmployeeOut) {
  const f: Record<string, unknown> = {};
  const want = (k: string) => !cur || has(input, k);
  for (const k of ['first_name', 'last_name', 'email', 'address', 'postal_code', 'city', 'bank_clearing', 'bank_account']) {
    if (want(k)) f[k] = str(input, k, { required: k === 'first_name' || k === 'last_name', label: k === 'first_name' ? 'Förnamn' : k === 'last_name' ? 'Efternamn' : k });
  }
  if (want('personal_number')) {
    const p = normalizePersonalNumber(str(input, 'personal_number', { required: true, label: 'Personnummer' }));
    if (!p) throw new ValidationError('Ogiltigt personnummer');
    f.personal_number = p;
  }
  if (want('employment_start')) f.employment_start = date(input, 'employment_start', 'Anställd från', false) || null;
  if (want('employment_end')) f.employment_end = date(input, 'employment_end', 'Anställd till', false) || null;
  if (want('monthly_salary')) {
    const s = optInt(input, 'monthly_salary', 'Månadslön (öre)') ?? 0;
    if (s < 0) throw new ValidationError('Ogiltig månadslön');
    f.monthly_salary = s;
  }
  if (want('tax_mode')) f.tax_mode = str(input, 'tax_mode') === 'percent' ? 'percent' : 'table';
  if (want('tax_table')) f.tax_table = optInt(input, 'tax_table', 'Skattetabell');
  if (want('tax_column')) f.tax_column = optInt(input, 'tax_column', 'Kolumn') ?? 1;
  if (want('tax_percent')) f.tax_percent = num(input, 'tax_percent', 'Skattesats');
  if (want('fee_override')) f.fee_override = num(input, 'fee_override', 'Arbetsgivaravgift');
  if (want('active')) f.active = has(input, 'active') ? bool(input, 'active') : true;
  const m = { ...cur, ...f } as Record<string, unknown>;
  if (m.tax_mode === 'table' && (!m.tax_table || (m.tax_table as number) < 29 || (m.tax_table as number) > 42)) throw new ValidationError('Ange skattetabell (29–42)');
  if (m.tax_mode === 'percent' && (m.tax_percent == null || (m.tax_percent as number) < 0 || (m.tax_percent as number) > 100)) throw new ValidationError('Ange skattesats i procent');
  if (m.tax_column != null && ((m.tax_column as number) < 1 || (m.tax_column as number) > 7)) throw new ValidationError('Kolumn måste vara 1–7');
  return f;
}

export async function createEmployee(actor: Actor, input: Record<string, unknown>) {
  const f = readEmployee(input);
  return sql.begin(async (tx) => {
    const [{ id }] = await tx<{ id: number }[]>`INSERT INTO employees ${tx({ ...f, company_id: actor.companyId })} RETURNING id`;
    const [e] = await tx<EmployeeOut[]>`SELECT ${ECOLS()} FROM employees WHERE id = ${id}`;
    await auditBy(tx, actor, 'create', 'employee', id);
    await emit(tx, actor.companyId, 'employee.created', e);
    return e;
  });
}

export async function updateEmployee(actor: Actor, id: number, input: Record<string, unknown>) {
  const cur = await getEmployee(actor.companyId, id);
  const f = readEmployee(input, cur);
  return sql.begin(async (tx) => {
    if (Object.keys(f).length) await tx`UPDATE employees SET ${tx(f)} WHERE id = ${id} AND company_id = ${actor.companyId}`;
    const [e] = await tx<EmployeeOut[]>`SELECT ${ECOLS()} FROM employees WHERE id = ${id}`;
    await auditBy(tx, actor, 'update', 'employee', id, Object.keys(f));
    await emit(tx, actor.companyId, 'employee.updated', e);
    return e;
  });
}

// ---------- Lönekörningar ----------

export interface PayslipOut {
  id: number; object: 'payslip'; employee_id: number; employee_name: string; items: PayItem[];
  gross_cash: number; benefits: number; tax: number; net_deductions: number; reimbursements: number; net_pay: number;
  employer_fee_rate: number; employer_fee: number;
}
export interface PayrollRunOut {
  id: number; object: 'payroll_run'; period: string; payment_date: string; status: 'draft' | 'booked';
  voucher_id: number | null; booked_at: string | null; created_at: string;
  totals: { gross_cash: number; benefits: number; tax: number; employer_fee: number; net_pay: number };
  payslips: PayslipOut[];
}

async function fetchRun(db: Tx | typeof sql, companyId: number, id: number): Promise<PayrollRunOut> {
  const [r] = await db<Omit<PayrollRunOut, 'payslips' | 'totals'>[]>`
    SELECT id, 'payroll_run' AS object, period, to_char(payment_date,'YYYY-MM-DD') AS payment_date, status, voucher_id, booked_at, created_at
    FROM payroll_runs WHERE id = ${id} AND company_id = ${companyId}`;
  if (!r) throw new NotFoundError('Lönekörningen');
  const slips = await db<PayslipOut[]>`
    SELECT p.id, 'payslip' AS object, p.employee_id, e.first_name || ' ' || e.last_name AS employee_name, p.items, p.gross_cash, p.benefits,
      p.tax, p.net_deductions, p.reimbursements, p.net_pay, p.employer_fee_rate::float8 AS employer_fee_rate, p.employer_fee
    FROM payslips p JOIN employees e ON e.id = p.employee_id WHERE p.run_id = ${id} ORDER BY e.last_name, e.first_name`;
  const sum = (k: keyof PayslipOut) => slips.reduce((s, p) => s + (p[k] as number), 0);
  return {
    ...r, payslips: [...slips],
    totals: { gross_cash: sum('gross_cash'), benefits: sum('benefits'), tax: sum('tax'), employer_fee: sum('employer_fee'), net_pay: sum('net_pay') },
  };
}
export const getPayrollRun = (companyId: number, id: number) => fetchRun(sql, companyId, id);

export async function listPayrollRuns(companyId: number, p: Page) {
  const rows = await sql<{ id: number }[]>`SELECT id FROM payroll_runs WHERE company_id = ${companyId}
    ${p.startingAfter ? sql`AND id > ${p.startingAfter}` : sql``} ORDER BY id LIMIT ${p.limit + 1}`;
  const res = list([...rows], p);
  return { ...res, data: await Promise.all(res.data.map((r) => getPayrollRun(companyId, r.id))) };
}

const defaultItems = (salary: number): PayItem[] => (salary ? [{ type: 'salary', description: 'Månadslön', amount: salary }] : []);

export async function createPayrollRun(actor: Actor, input: Record<string, unknown>) {
  const period = str(input, 'period', { required: true, label: 'Period' });
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new ValidationError('Ange period som ÅÅÅÅ-MM');
  const paymentDate = date(input, 'payment_date', 'Utbetalningsdag');
  if (!paymentDate.startsWith(period)) throw new ValidationError('Utbetalningsdatumet måste ligga i redovisningsperioden (AGI redovisas per utbetalningsmånad)');
  return sql.begin(async (tx) => {
    const exists = await tx`SELECT 1 FROM payroll_runs WHERE company_id = ${actor.companyId} AND period = ${period}`;
    if (exists.length) throw new ConflictError(`Det finns redan en lönekörning för ${period}`);
    const [{ id }] = await tx<{ id: number }[]>`INSERT INTO payroll_runs (company_id, period, payment_date) VALUES (${actor.companyId}, ${period}, ${paymentDate}) RETURNING id`;
    const emps = await tx<{ id: number; monthly_salary: number }[]>`
      SELECT id, monthly_salary FROM employees WHERE company_id = ${actor.companyId} AND active
        AND (employment_end IS NULL OR employment_end >= ${period + '-01'}) ORDER BY last_name`;
    for (const e of emps) {
      const [p] = await tx<{ id: number }[]>`INSERT INTO payslips (run_id, employee_id, items, employer_fee_rate)
        VALUES (${id}, ${e.id}, ${tx.json(defaultItems(e.monthly_salary) as never)}, 0) RETURNING id`;
      await recomputeSlip(tx, p.id);
    }
    await auditBy(tx, actor, 'create', 'payroll_run', id, { period });
    const out = await fetchRun(tx, actor.companyId, id);
    await emit(tx, actor.companyId, 'payroll_run.created', out);
    return out;
  });
}

async function assertDraft(tx: Tx, companyId: number, runId: number) {
  const [r] = await tx<{ status: string }[]>`SELECT status FROM payroll_runs WHERE id = ${runId} AND company_id = ${companyId} FOR UPDATE`;
  if (!r) throw new NotFoundError('Lönekörningen');
  if (r.status !== 'draft') throw new ConflictError('Lönekörningen är bokförd och kan inte ändras');
}

const TYPES: PayItemType[] = ['salary', 'benefit', 'net_deduction', 'reimbursement'];

export function parseItems(input: Record<string, unknown>): PayItem[] {
  return arr(input, 'items', 'Lönerader').map((r) => {
    const type = str(r, 'type') as PayItemType;
    if (!TYPES.includes(type)) throw new ValidationError(`Ogiltig lönearttyp: ${type}`);
    const description = str(r, 'description') || 'Rad';
    const amount = int(r, 'amount', `Belopp (öre) på raden "${description}"`);
    if (type !== 'salary' && amount < 0) throw new ValidationError(`Negativt belopp är bara tillåtet för lönerader ("${description}")`);
    const item: PayItem = { type, description, amount };
    if (type === 'reimbursement') item.account = optInt(r, 'account', 'Konto') ?? 5800;
    return item;
  });
}

export async function updatePayslip(actor: Actor, runId: number, slipId: number, input: Record<string, unknown>) {
  const items = parseItems(input);
  return sql.begin(async (tx) => {
    await assertDraft(tx, actor.companyId, runId);
    const r = await tx`UPDATE payslips SET items = ${tx.json(items as never)} WHERE id = ${slipId} AND run_id = ${runId} RETURNING id`;
    if (!r.length) throw new NotFoundError('Lönespecen');
    await recomputeSlip(tx, slipId);
    await auditBy(tx, actor, 'update', 'payslip', slipId);
    return fetchRun(tx, actor.companyId, runId);
  });
}

export async function addEmployeeToRun(actor: Actor, runId: number, employeeId: number) {
  return sql.begin(async (tx) => {
    await assertDraft(tx, actor.companyId, runId);
    const [e] = await tx<{ id: number; monthly_salary: number }[]>`SELECT id, monthly_salary FROM employees WHERE id = ${employeeId} AND company_id = ${actor.companyId}`;
    if (!e) throw new ValidationError('Den anställda finns inte');
    const [p] = await tx<{ id: number }[]>`INSERT INTO payslips (run_id, employee_id, items, employer_fee_rate)
      VALUES (${runId}, ${e.id}, ${tx.json(defaultItems(e.monthly_salary) as never)}, 0) ON CONFLICT DO NOTHING RETURNING id`;
    if (p) await recomputeSlip(tx, p.id);
    await auditBy(tx, actor, 'add', 'payslip', p?.id);
    return fetchRun(tx, actor.companyId, runId);
  });
}

export async function removePayslip(actor: Actor, runId: number, slipId: number) {
  return sql.begin(async (tx) => {
    await assertDraft(tx, actor.companyId, runId);
    await tx`DELETE FROM payslips WHERE id = ${slipId} AND run_id = ${runId}`;
    await auditBy(tx, actor, 'remove', 'payslip', slipId);
    return fetchRun(tx, actor.companyId, runId);
  });
}

export async function deletePayrollRun(actor: Actor, runId: number) {
  await sql.begin(async (tx) => {
    await assertDraft(tx, actor.companyId, runId);
    await tx`DELETE FROM payroll_runs WHERE id = ${runId}`;
    await auditBy(tx, actor, 'delete', 'payroll_run', runId);
  });
  return { id: runId, object: 'payroll_run', deleted: true };
}

/** Räknar om alla lönespecar och bokför lönekörningen på utbetalningsdagen */
export async function bookPayrollRun(actor: Actor, runId: number) {
  return sql.begin(async (tx) => {
    await assertDraft(tx, actor.companyId, runId);
    const [r] = await tx<{ period: string; payment_date: string }[]>`SELECT period, to_char(payment_date,'YYYY-MM-DD') AS payment_date FROM payroll_runs WHERE id = ${runId}`;
    const slips = await tx<{ id: number; items: PayItem[] }[]>`SELECT id, items FROM payslips WHERE run_id = ${runId}`;
    if (slips.length === 0) throw new ValidationError('Lönekörningen saknar lönespecifikationer');
    const calcs = [];
    for (const s of slips) calcs.push({ calc: await recomputeSlip(tx, s.id), items: s.items });
    const v = await createVoucher(tx, {
      actor, date: r.payment_date, description: `Lön ${r.period}`, lines: payrollBookingLines(calcs), sourceType: 'payroll', sourceId: runId, series: 'L',
    });
    await tx`UPDATE payroll_runs SET status = 'booked', voucher_id = ${v.id}, booked_by = ${actor.userId}, booked_at = now() WHERE id = ${runId}`;
    await auditBy(tx, actor, 'book', 'payroll_run', runId);
    const out = await fetchRun(tx, actor.companyId, runId);
    await emit(tx, actor.companyId, 'payroll_run.booked', out);
    return out;
  });
}

/** AGI-fil (XML) för en bokförd lönekörnings redovisningsperiod */
export async function buildAgiForRun(actor: Actor, runId: number): Promise<{ filename: string; xml: string }> {
  const [run] = await sql<{ period: string; status: string }[]>`SELECT period, status FROM payroll_runs WHERE id = ${runId} AND company_id = ${actor.companyId}`;
  if (!run) throw new NotFoundError('Lönekörningen');
  if (run.status !== 'booked') throw new ConflictError('Lönekörningen måste bokföras innan AGI kan skapas');
  const [company] = await sql<{ orgnr: string; company_type: 'AB' | 'EF'; phone: string }[]>`SELECT orgnr, company_type, phone FROM companies WHERE id = ${actor.companyId}`;
  if (!company.phone) throw new ValidationError('Ange telefonnummer under Inställningar – det krävs som kontaktuppgift i AGI');
  const [user] = await sql<{ name: string; email: string }[]>`SELECT name, email FROM users WHERE id = ${actor.userId}`;
  const slips = await sql<{ personal_number: string; gross: number; benefits: number; tax: number; fee: number }[]>`
    SELECT e.personal_number, SUM(p.gross_cash)::bigint AS gross, SUM(p.benefits)::bigint AS benefits, SUM(p.tax)::bigint AS tax, SUM(p.employer_fee)::bigint AS fee
    FROM payslips p JOIN employees e ON e.id = p.employee_id JOIN payroll_runs r ON r.id = p.run_id
    WHERE r.company_id = ${actor.companyId} AND r.period = ${run.period} AND r.status = 'booked'
    GROUP BY e.personal_number ORDER BY e.personal_number`;
  const ownerPnr = company.company_type === 'EF'
    ? (Number(company.orgnr.slice(0, 2)) > new Date().getFullYear() % 100 ? '19' : '20') + company.orgnr.replace(/\D/g, '')
    : undefined;
  const xml = buildAgiXml({
    period: run.period,
    employer: { agId: agiId(company.orgnr, company.company_type, ownerPnr), contactName: user.name, contactPhone: company.phone, contactEmail: user.email },
    individuals: slips.map((s) => ({ personalNumber: s.personal_number, specNumber: 1, grossCash: s.gross, benefits: s.benefits, tax: s.tax })),
    totalEmployerFees: slips.reduce((a, s) => a + s.fee, 0),
    totalTax: slips.reduce((a, s) => a + s.tax, 0),
    programName: 'Bokforing',
  });
  return { filename: `AGI_${run.period}.xml`, xml };
}
