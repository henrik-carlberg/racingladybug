import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { recomputeSlip } from '@/lib/server/payroll';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { birthYearFromPersonalNumber, employerFee, type PayItem } from '@/lib/payroll';
import { ACCRUED_FEES, ACCRUED_SALARY, FEE_ACCOUNT, accrualLines, profitShare, type Plan } from '@/lib/profit-share';
import type { Actor } from './actor';
import { int, str } from './input';
import { yearStatus } from './yearend';

type PlanRow = Plan & { id: number; employee_id: number; employee: string; personal_number: string; note: string };

const plans = (db: Tx | typeof sql, companyId: number) => db<PlanRow[]>`
  SELECT p.id, p.employee_id, e.first_name || ' ' || e.last_name AS employee, e.personal_number, p.kind, p.pct, p.target::float8 AS target, p.amount::float8 AS amount, p.cap::float8 AS cap, p.note
  FROM profit_share_plans p JOIN employees e ON e.id = p.employee_id WHERE p.company_id = ${companyId} ORDER BY e.last_name`;

/** Resultat före tantiem och skatt: årets resultat med redan upplupen tantiem återlagd */
async function baseResult(companyId: number, fyId: number) {
  const s = await yearStatus(companyId, fyId);
  const [{ booked }] = await sql<{ booked: number }[]>`SELECT COALESCE(SUM(v.amount + v.fee), 0)::float8 AS booked FROM profit_share_vouchers v
    JOIN profit_share_accruals a ON a.id = v.accrual_id JOIN profit_share_plans p ON p.id = a.plan_id WHERE p.company_id = ${companyId} AND a.fiscal_year_id = ${fyId}`;
  return s.resultBeforeTax + booked;
}

export async function overview(companyId: number, fyId: number | null) {
  const fys = await sql<{ id: number; start: string; end: string; closed: boolean }[]>`SELECT id, to_char(start_date,'YYYY-MM-DD') AS start, to_char(end_date,'YYYY-MM-DD') AS end, closed FROM fiscal_years WHERE company_id = ${companyId} ORDER BY start_date DESC`;
  const fy = fys.find((f) => f.id === fyId) ?? fys[0];
  const list = await plans(sql, companyId);
  const result = fy ? await baseResult(companyId, fy.id) : 0;
  const acc = fy ? new Map((await sql<{ plan_id: number; id: number; amount: number; fee: number; payout_run_id: number | null; reversal_voucher_id: number | null; period: string | null }[]>`
    SELECT a.plan_id, a.id, a.amount::float8 AS amount, a.fee::float8 AS fee, a.payout_run_id, a.reversal_voucher_id, r.period FROM profit_share_accruals a LEFT JOIN payroll_runs r ON r.id = a.payout_run_id
    WHERE a.fiscal_year_id = ${fy.id}`).map((a) => [a.plan_id, a])) : new Map();
  const runs = await sql<{ id: number; period: string }[]>`SELECT id, period FROM payroll_runs WHERE company_id = ${companyId} AND status = 'draft' ORDER BY period`;
  const employees = await sql<{ id: number; name: string }[]>`SELECT id, first_name || ' ' || last_name AS name FROM employees WHERE company_id = ${companyId} AND active ORDER BY last_name`;
  const rows = list.map((p) => ({ ...p, proposal: profitShare(p, result), accrual: acc.get(p.id) ?? null }));
  return { fys, fy, result, rows, runs, employees };
}

export async function addPlan(actor: Actor, input: Record<string, unknown>) {
  const employeeId = int(input, 'employee_id', 'Anställd');
  const [e] = await sql`SELECT 1 FROM employees WHERE id = ${employeeId} AND company_id = ${actor.companyId}`;
  if (!e) throw new ValidationError('Den anställda finns inte');
  const kind = input.kind === 'target' ? 'target' : 'percent';
  const money = (k: string, label: string, required: boolean) => { const s = String(input[k] ?? '').trim(); if (!s) { if (required) throw new ValidationError(`Ange ${label}`); return null; } const n = parseAmount(s); if (n == null || n <= 0) throw new ValidationError(`Ange ${label} i kronor`); return n; };
  let pct: number | null = null;
  if (kind === 'percent') { const v = Number(String(input.pct ?? '').replace(',', '.')); if (!(v > 0 && v <= 50)) throw new ValidationError('Ange andelen av resultatet i procent (högst 50)'); pct = Math.round(v * 100); }
  const target = kind === 'target' ? money('target', 'resultatmålet', true) : null;
  const amount = kind === 'target' ? money('amount', 'tantiemen vid uppnått mål', true) : null;
  const [r] = await sql<{ id: number }[]>`INSERT INTO profit_share_plans ${sql({ company_id: actor.companyId, employee_id: employeeId, kind, pct, target, amount, cap: money('cap', 'taket', false), note: str(input, 'note', { max: 300 }), created_by: actor.userId })} RETURNING id`;
  await auditBy(sql, actor, 'profit_share_plan', 'profit_share_plan', r.id, { employee_id: employeeId, kind });
  return r.id;
}

/** Tantiemen per bokslutsdagen bokförs som upplupen lön med sociala avgifter (ändringen mot tidigare bokfört) */
export async function accrue(actor: Actor, fyId: number) {
  const [fy] = await sql<{ end: string; closed: boolean }[]>`SELECT to_char(end_date,'YYYY-MM-DD') AS end, closed FROM fiscal_years WHERE id = ${fyId} AND company_id = ${actor.companyId}`;
  if (!fy) throw new NotFoundError('Räkenskapsåret');
  if (fy.closed) throw new ConflictError('Räkenskapsåret är stängt');
  const result = await baseResult(actor.companyId, fyId);
  return sql.begin(async (tx) => {
    await tx`SELECT 1 FROM companies WHERE id = ${actor.companyId} FOR UPDATE`;
    const changes: { planId: number; accrualId: number | null; amount: number; fee: number }[] = [];
    for (const p of await plans(tx, actor.companyId)) {
      const [a] = await tx<{ id: number; amount: number; fee: number; payout_run_id: number | null }[]>`SELECT id, amount::float8 AS amount, fee::float8 AS fee, payout_run_id FROM profit_share_accruals WHERE plan_id = ${p.id} AND fiscal_year_id = ${fyId} FOR UPDATE`;
      if (a?.payout_run_id) continue; // redan lagd på lön
      const amount = profitShare(p, result);
      const fee = employerFee(amount, birthYearFromPersonalNumber(p.personal_number), fy.end).fee;
      if (amount - (a?.amount ?? 0) || fee - (a?.fee ?? 0)) changes.push({ planId: p.id, accrualId: a?.id ?? null, amount: amount - (a?.amount ?? 0), fee: fee - (a?.fee ?? 0) });
    }
    if (!changes.length) throw new ValidationError('Den upplupna tantiemen stämmer redan');
    for (const [n, name] of [[ACCRUED_SALARY, 'Upplupna löner'], [ACCRUED_FEES, 'Upplupna lagstadgade sociala avgifter'], [FEE_ACCOUNT, 'Sociala avgifter för upplupna löner']] as const)
      await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${n}, ${name}) ON CONFLICT DO NOTHING`;
    const v = await createVoucher(tx, { actor, date: fy.end, description: 'Upplupen tantiem med sociala avgifter', sourceType: 'profit_share', sourceId: null,
      lines: fromSigned(changes.flatMap((c) => accrualLines(c.amount, c.fee))) });
    let total = 0;
    for (const c of changes) {
      const [a] = await tx<{ id: number }[]>`INSERT INTO profit_share_accruals (plan_id, fiscal_year_id, amount, fee) VALUES (${c.planId}, ${fyId}, ${c.amount}, ${c.fee})
        ON CONFLICT (plan_id, fiscal_year_id) DO UPDATE SET amount = profit_share_accruals.amount + EXCLUDED.amount, fee = profit_share_accruals.fee + EXCLUDED.fee RETURNING id`;
      await tx`INSERT INTO profit_share_vouchers (accrual_id, amount, fee, voucher_id) VALUES (${a.id}, ${c.amount}, ${c.fee}, ${v.id})`;
      total += c.amount + c.fee;
    }
    await auditBy(tx, actor, 'profit_share_accrual', 'voucher', v.id, { result, total });
    return { result, total };
  });
}

/** Lägger tantiemen som lönetillägg på den anställdas lönespec i en lönekörning (utkast) */
export async function addToRun(actor: Actor, accrualId: number, input: Record<string, unknown>) {
  const runId = int(input, 'run_id', 'Lönekörning');
  return sql.begin(async (tx) => {
    const [a] = await tx<{ amount: number; employee_id: number; payout_run_id: number | null; year: string }[]>`SELECT a.amount::float8 AS amount, p.employee_id, a.payout_run_id, to_char(f.end_date,'YYYY') AS year
      FROM profit_share_accruals a JOIN profit_share_plans p ON p.id = a.plan_id JOIN fiscal_years f ON f.id = a.fiscal_year_id WHERE a.id = ${accrualId} AND p.company_id = ${actor.companyId} FOR UPDATE OF a`;
    if (!a) throw new NotFoundError('Tantiemen');
    if (a.payout_run_id) throw new ConflictError('Tantiemen är redan lagd på en lönekörning');
    if (a.amount <= 0) throw new ValidationError('Ingen tantiem att betala ut');
    const [r] = await tx<{ status: string }[]>`SELECT status FROM payroll_runs WHERE id = ${runId} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!r || r.status !== 'draft') throw new ConflictError('Välj en lönekörning som inte är bokförd');
    const [slip] = await tx<{ id: number; items: PayItem[] }[]>`SELECT id, items FROM payslips WHERE run_id = ${runId} AND employee_id = ${a.employee_id}`;
    if (!slip) throw new ValidationError('Den anställda finns inte med i lönekörningen');
    const items = [...slip.items, { type: 'salary' as const, description: `Tantiem ${a.year}`, amount: a.amount, code: 'tantiem' as const }];
    await tx`UPDATE payslips SET items = ${tx.json(items as never)} WHERE id = ${slip.id}`;
    await recomputeSlip(tx, slip.id);
    await tx`UPDATE profit_share_accruals SET payout_run_id = ${runId} WHERE id = ${accrualId}`;
    await auditBy(tx, actor, 'profit_share_payout', 'payroll_run', runId, { accrual_id: accrualId, amount: a.amount });
    return a.amount;
  });
}

/** Lönekörningen ändras: tantiem som inte längre finns på lönespecen kan läggas på igen */
export async function syncRun(tx: Tx, runId: number, employeeId: number | null, items: PayItem[] | null) {
  if (items && items.some((i) => i.code === 'tantiem')) return;
  await tx`UPDATE profit_share_accruals a SET payout_run_id = NULL FROM profit_share_plans p WHERE p.id = a.plan_id AND a.payout_run_id = ${runId}
    AND a.reversal_voucher_id IS NULL ${employeeId ? tx`AND p.employee_id = ${employeeId}` : tx``}`;
}

/** När lönekörningen bokförs (lönen på 7210/7510) löses den upplupna tantiemen upp */
export async function releaseForRun(tx: Tx, actor: Actor, runId: number, paymentDate: string) {
  const list = await tx<{ id: number; amount: number; fee: number; employee: string }[]>`SELECT a.id, a.amount::float8 AS amount, a.fee::float8 AS fee, e.first_name || ' ' || e.last_name AS employee
    FROM profit_share_accruals a JOIN profit_share_plans p ON p.id = a.plan_id JOIN employees e ON e.id = p.employee_id WHERE a.payout_run_id = ${runId} AND a.reversal_voucher_id IS NULL`;
  for (const a of list) {
    const v = await createVoucher(tx, { actor, date: paymentDate, description: `Upplöst upplupen tantiem, ${a.employee}`, sourceType: 'profit_share', sourceId: a.id, lines: fromSigned(accrualLines(-a.amount, -a.fee)) });
    await tx`UPDATE profit_share_accruals SET reversal_voucher_id = ${v.id} WHERE id = ${a.id}`;
  }
}
