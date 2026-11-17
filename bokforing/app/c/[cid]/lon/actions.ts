'use server';
import { sql } from '@/lib/db';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { audit } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { recomputeSlip } from '@/lib/server/payroll';
import { payrollBookingLines, type PayItem, type PayItemType } from '@/lib/payroll';
import { parseAmount } from '@/lib/money';

const TYPES: PayItemType[] = ['salary', 'benefit', 'net_deduction', 'reimbursement'];

export async function createRun(cid: number, fd: FormData) {
  const { company, user } = await requireCompany(cid);
  let id = 0;
  await attempt(`/c/${cid}/lon`, async () => {
    const period = str(fd, 'period');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error('Ange period som ÅÅÅÅ-MM');
    const paymentDate = str(fd, 'payment_date');
    if (!paymentDate.startsWith(period)) throw new Error('Utbetalningsdatumet måste ligga i redovisningsperioden (AGI redovisas per utbetalningsmånad)');
    await sql.begin(async (tx) => {
      const exists = await tx`SELECT 1 FROM payroll_runs WHERE company_id = ${company.id} AND period = ${period}`;
      if (exists.length) throw new Error(`Det finns redan en lönekörning för ${period}`);
      [{ id }] = await tx<{ id: number }[]>`INSERT INTO payroll_runs (company_id, period, payment_date) VALUES (${company.id}, ${period}, ${paymentDate}) RETURNING id`;
      const emps = await tx<{ id: number; monthly_salary: number }[]>`
        SELECT id, monthly_salary FROM employees WHERE company_id = ${company.id} AND active
          AND (employment_end IS NULL OR employment_end >= ${period + '-01'}) ORDER BY last_name`;
      for (const e of emps) {
        const items: PayItem[] = e.monthly_salary ? [{ type: 'salary', description: 'Månadslön', amount: e.monthly_salary }] : [];
        const [p] = await tx<{ id: number }[]>`INSERT INTO payslips (run_id, employee_id, items, employer_fee_rate)
          VALUES (${id}, ${e.id}, ${tx.json(items as never)}, 0) RETURNING id`;
        await recomputeSlip(tx, p.id);
      }
      await audit(tx, { companyId: company.id, userId: user.id, action: 'create', entity: 'payroll_run', entityId: id, details: { period } });
    });
  });
  done(`/c/${cid}/lon/${id}`, 'Lönekörningen är skapad');
}

async function draftRun(companyId: number, runId: number) {
  const [r] = await sql<{ status: string }[]>`SELECT status FROM payroll_runs WHERE id = ${runId} AND company_id = ${companyId}`;
  if (!r) throw new Error('Lönekörningen finns inte');
  if (r.status !== 'draft') throw new Error('Lönekörningen är bokförd och kan inte ändras');
}

export async function saveSlip(cid: number, runId: number, slipId: number, fd: FormData) {
  const { company, user } = await requireCompany(cid);
  await attempt(`/c/${cid}/lon/${runId}#p${slipId}`, async () => {
    await draftRun(company.id, runId);
    const items: PayItem[] = [];
    for (let i = 0; i < 20; i++) {
      const desc = str(fd, `desc_${i}`);
      const amt = str(fd, `amount_${i}`);
      if (!desc && !amt) continue;
      const type = str(fd, `type_${i}`) as PayItemType;
      if (!TYPES.includes(type)) throw new Error('Ogiltig lönearttyp');
      const amount = parseAmount(amt);
      if (amount == null) throw new Error(`Ogiltigt belopp på raden "${desc}"`);
      if (type !== 'salary' && amount < 0) throw new Error(`Negativt belopp är bara tillåtet för lönerader ("${desc}")`);
      const item: PayItem = { type, description: desc || 'Rad', amount };
      if (type === 'reimbursement') item.account = Number(str(fd, `account_${i}`)) || 5800;
      items.push(item);
    }
    await sql.begin(async (tx) => {
      const r = await tx`UPDATE payslips SET items = ${tx.json(items as never)} WHERE id = ${slipId} AND run_id = ${runId} RETURNING id`;
      if (!r.length) throw new Error('Lönespecen finns inte');
      await recomputeSlip(tx, slipId);
      await audit(tx, { companyId: company.id, userId: user.id, action: 'update', entity: 'payslip', entityId: slipId });
    });
  });
  done(`/c/${cid}/lon/${runId}#p${slipId}`);
}

export async function addEmployee(cid: number, runId: number, fd: FormData) {
  const { company, user } = await requireCompany(cid);
  await attempt(`/c/${cid}/lon/${runId}`, async () => {
    await draftRun(company.id, runId);
    const empId = Number(str(fd, 'employee_id'));
    await sql.begin(async (tx) => {
      const [e] = await tx<{ id: number; monthly_salary: number }[]>`SELECT id, monthly_salary FROM employees WHERE id = ${empId} AND company_id = ${company.id}`;
      if (!e) throw new Error('Välj anställd');
      const items: PayItem[] = e.monthly_salary ? [{ type: 'salary', description: 'Månadslön', amount: e.monthly_salary }] : [];
      const [p] = await tx<{ id: number }[]>`INSERT INTO payslips (run_id, employee_id, items, employer_fee_rate)
        VALUES (${runId}, ${e.id}, ${tx.json(items as never)}, 0) ON CONFLICT DO NOTHING RETURNING id`;
      if (p) await recomputeSlip(tx, p.id);
      await audit(tx, { companyId: company.id, userId: user.id, action: 'add', entity: 'payslip', entityId: p?.id });
    });
  });
  done(`/c/${cid}/lon/${runId}`);
}

export async function removeSlip(cid: number, runId: number, slipId: number) {
  const { company, user } = await requireCompany(cid);
  await attempt(`/c/${cid}/lon/${runId}`, async () => {
    await draftRun(company.id, runId);
    await sql`DELETE FROM payslips WHERE id = ${slipId} AND run_id = ${runId}`;
    await audit(sql, { companyId: company.id, userId: user.id, action: 'remove', entity: 'payslip', entityId: slipId });
  });
  done(`/c/${cid}/lon/${runId}`);
}

export async function deleteRun(cid: number, runId: number) {
  const { company, user } = await requireCompany(cid);
  await attempt(`/c/${cid}/lon/${runId}`, async () => {
    await draftRun(company.id, runId);
    await sql`DELETE FROM payroll_runs WHERE id = ${runId} AND company_id = ${company.id} AND status = 'draft'`;
    await audit(sql, { companyId: company.id, userId: user.id, action: 'delete', entity: 'payroll_run', entityId: runId });
  });
  done(`/c/${cid}/lon`, 'Utkastet är borttaget');
}

/** Räknar om alla lönespecar och bokför lönekörningen på utbetalningsdagen */
export async function bookRun(cid: number, runId: number) {
  const { company, user } = await requireCompany(cid);
  await attempt(`/c/${cid}/lon/${runId}`, async () => {
    await sql.begin(async (tx) => {
      const [r] = await tx<{ status: string; period: string; payment_date: string }[]>`
        SELECT status, period, to_char(payment_date,'YYYY-MM-DD') AS payment_date FROM payroll_runs WHERE id = ${runId} AND company_id = ${company.id} FOR UPDATE`;
      if (!r || r.status !== 'draft') throw new Error('Lönekörningen är redan bokförd');
      const slips = await tx<{ id: number; items: PayItem[] }[]>`SELECT id, items FROM payslips WHERE run_id = ${runId}`;
      if (slips.length === 0) throw new Error('Lönekörningen saknar lönespecifikationer');
      const calcs = [];
      for (const s of slips) calcs.push({ calc: await recomputeSlip(tx, s.id), items: s.items });
      const v = await createVoucher(tx, {
        companyId: company.id, userId: user.id, date: r.payment_date, description: `Lön ${r.period}`,
        lines: payrollBookingLines(calcs), sourceType: 'payroll', sourceId: runId, series: 'L',
      });
      await tx`UPDATE payroll_runs SET status = 'booked', voucher_id = ${v.id}, booked_by = ${user.id}, booked_at = now() WHERE id = ${runId}`;
      await audit(tx, { companyId: company.id, userId: user.id, action: 'book', entity: 'payroll_run', entityId: runId });
    });
  });
  done(`/c/${cid}/lon/${runId}`, 'Lönekörningen är bokförd. Ladda ner AGI-filen och lämna den till Skatteverket (normalt senast den 12:e månaden efter utbetalning, 17:e i januari och augusti).');
}
