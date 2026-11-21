import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { recomputeSlip } from '@/lib/server/payroll';
import { fromSigned } from '@/lib/ledger-lines';
import { ACC } from '@/lib/bas';
import { createVoucher } from '@/lib/server/ledger';
import { benefitRate, loanItems } from '@/lib/employee-loans';
import type { PayItem } from '@/lib/payroll';
import type { Actor } from './actor';
import { parseAmount } from '@/lib/money';
import { date, int } from './input';

const kronor = (v: unknown, label: string) => { const n = parseAmount(String(v ?? '').trim()); if (n == null || n <= 0) throw new ValidationError(`Ange ${label} i kronor`); return n; };

const rate = (v: unknown) => { const n = Number(String(v ?? '0').replace(',', '.')); if (!Number.isFinite(n) || n < 0 || n >= 50) throw new ValidationError('Ange räntan i procent'); return Math.round(n * 100) / 100; };

/** Saldot: lånebeloppet minus amorteringar i bokförda lönekörningar */
export async function overview(companyId: number) {
  const loans = await sql<{ id: number; employee_id: number; name: string; principal: number; agreed_rate: number; installment: number; loan_date: string; repaid: number; pending: number; applied: number[] }[]>`
    SELECT l.id, l.employee_id, e.first_name || ' ' || e.last_name AS name, l.principal::float8 AS principal, l.agreed_rate::float8 AS agreed_rate, l.installment::float8 AS installment, to_char(l.loan_date,'YYYY-MM-DD') AS loan_date,
      COALESCE((SELECT SUM(i.amortization) FROM employee_loan_installments i JOIN payroll_runs r ON r.id = i.run_id WHERE i.loan_id = l.id AND r.status = 'booked'), 0)::float8 AS repaid,
      COALESCE((SELECT SUM(i.amortization) FROM employee_loan_installments i JOIN payroll_runs r ON r.id = i.run_id WHERE i.loan_id = l.id AND r.status = 'draft'), 0)::float8 AS pending,
      ARRAY(SELECT i.run_id FROM employee_loan_installments i WHERE i.loan_id = l.id) AS applied
    FROM employee_loans l JOIN employees e ON e.id = l.employee_id WHERE l.company_id = ${companyId} ORDER BY l.loan_date DESC, l.id DESC`;
  const runs = await sql<{ id: number; period: string }[]>`SELECT id, period FROM payroll_runs WHERE company_id = ${companyId} AND status = 'draft' ORDER BY period`;
  const employees = await sql<{ id: number; name: string }[]>`SELECT id, first_name || ' ' || last_name AS name FROM employees WHERE company_id = ${companyId} AND active ORDER BY last_name, first_name`;
  return { loans: loans.map((l) => ({ ...l, balance: l.principal - l.repaid })), runs, employees };
}

/** Lånet betalas ut: fordran på den anställde (1610) mot bank */
export async function addLoan(actor: Actor, input: Record<string, unknown>) {
  const employeeId = int(input, 'employee_id', 'Anställd');
  const principal = kronor(input.principal, 'lånebeloppet');
  const installment = kronor(input.installment, 'amorteringen per månad');
  const d = date(input, 'loan_date', 'Utbetalningsdag');
  const agreed = rate(input.agreed_rate);
  return sql.begin(async (tx) => {
    const [e] = await tx<{ name: string }[]>`SELECT first_name || ' ' || last_name AS name FROM employees WHERE id = ${employeeId} AND company_id = ${actor.companyId}`;
    if (!e) throw new NotFoundError('Den anställda');
    const v = await createVoucher(tx, { actor, date: d, description: `Lån till anställd, ${e.name}`, lines: fromSigned([{ account: ACC.employeeReceivables, amount: principal }, { account: ACC.bank, amount: -principal }]), sourceType: 'employee_loan' });
    const [r] = await tx<{ id: number }[]>`INSERT INTO employee_loans ${tx({ company_id: actor.companyId, employee_id: employeeId, principal, agreed_rate: agreed, installment, loan_date: d, voucher_id: v.id, created_by: actor.userId })} RETURNING id`;
    await auditBy(tx, actor, 'create', 'employee_loan', r.id, { principal });
    return { name: e.name, benefitRate: benefitRate(Number(d.slice(0, 4))), agreed };
  });
}

/** Lägger in månadens amortering, ränta och ränteförmån på den anställdas lönespec i en lönekörning som inte är bokförd */
export async function applyToRun(actor: Actor, loanId: number, input: Record<string, unknown>) {
  const runId = int(input, 'run_id', 'Lönekörning');
  return sql.begin(async (tx) => {
    const [l] = await tx<{ employee_id: number; principal: number; agreed_rate: number; installment: number; name: string }[]>`SELECT l.employee_id, l.principal::float8 AS principal, l.agreed_rate::float8 AS agreed_rate,
      l.installment::float8 AS installment, e.first_name || ' ' || e.last_name AS name FROM employee_loans l JOIN employees e ON e.id = l.employee_id WHERE l.id = ${loanId} AND l.company_id = ${actor.companyId} FOR UPDATE OF l`;
    if (!l) throw new NotFoundError('Lånet');
    const [run] = await tx<{ status: string; payment_date: string }[]>`SELECT status, to_char(payment_date,'YYYY-MM-DD') AS payment_date FROM payroll_runs WHERE id = ${runId} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!run) throw new NotFoundError('Lönekörningen');
    if (run.status !== 'draft') throw new ConflictError('Lönekörningen är redan bokförd');
    const [dup] = await tx`SELECT 1 FROM employee_loan_installments WHERE loan_id = ${loanId} AND run_id = ${runId}`;
    if (dup) throw new ConflictError('Lånet är redan med i lönekörningen');
    const [{ paid }] = await tx<{ paid: number }[]>`SELECT COALESCE(SUM(amortization), 0)::float8 AS paid FROM employee_loan_installments WHERE loan_id = ${loanId}`;
    const balance = l.principal - paid;
    if (balance <= 0) throw new ConflictError('Lånet är återbetalt');
    const [slip] = await tx<{ id: number; items: PayItem[] }[]>`SELECT id, items FROM payslips WHERE run_id = ${runId} AND employee_id = ${l.employee_id} FOR UPDATE`;
    if (!slip) throw new ValidationError(`${l.name} finns inte med i lönekörningen`);
    const r = loanItems({ balance, agreedRate: l.agreed_rate, installment: l.installment }, Number(run.payment_date.slice(0, 4)));
    await tx`UPDATE payslips SET items = ${tx.json([...slip.items, ...r.items] as never)} WHERE id = ${slip.id}`;
    await recomputeSlip(tx, slip.id);
    // Den avtalade räntan bokförs som ränteintäkt i lönekörningens verifikation (nettolöneavdraget minskar fordran med amortering och ränta)
    await tx`INSERT INTO employee_loan_installments ${tx({ loan_id: loanId, run_id: runId, amortization: r.amortization, interest: r.interest, benefit: r.benefit })}`;
    await auditBy(tx, actor, 'employee_loan_run', 'employee_loan', loanId, { runId, ...r, items: undefined });
    return r;
  });
}
