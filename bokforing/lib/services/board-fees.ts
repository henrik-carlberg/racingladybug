import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { recomputeSlip } from '@/lib/server/payroll';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { normalizePersonalNumber } from '@/lib/validate';
import { today } from '@/lib/format';
import { assess, FEE_ACCOUNT, invoiceLines, period, type Mode, type Recipient } from '@/lib/board-fees';
import type { Actor } from './actor';
import { createEmployee } from './payroll';
import { date, optInt, str } from './input';

const kronor = (v: unknown, label: string, zero = false) => { const n = parseAmount(String(v ?? '').trim() || (zero ? '0' : '')); if (n == null || n < 0 || (!zero && !n)) throw new ValidationError(`Ange ${label} i kronor`); return n; };
const addYear = (d: string) => `${Number(d.slice(0, 4)) + 1}${d.slice(4)}`;

type Member = { id: number; name: string; id_number: string; role: string; agm_date: string; annual_fee: number; mode: Mode; recipient: Recipient; f_skatt: boolean; in_business: boolean; employee_id: number | null };
const COLS = sql`id, name, id_number, role, to_char(agm_date,'YYYY-MM-DD') AS agm_date, annual_fee::float8 AS annual_fee, mode, recipient, f_skatt, in_business, employee_id`;

export async function overview(companyId: number) {
  const members = await sql<Member[]>`SELECT ${COLS} FROM board_members WHERE company_id = ${companyId} ORDER BY agm_date DESC, name`;
  const rows = [];
  for (const m of members) {
    const [p] = await sql<{ paid: number }[]>`SELECT COALESCE(SUM(amount), 0)::float8 AS paid FROM board_fee_payments WHERE member_id = ${m.id} AND date >= ${m.agm_date} AND date < ${addYear(m.agm_date)}`;
    rows.push({ ...m, period: period(m.agm_date), paid: p.paid, assessment: assess({ mode: m.mode, recipient: m.recipient, fSkatt: m.f_skatt, inBusiness: m.in_business }) });
  }
  const runs = await sql<{ id: number; period: string }[]>`SELECT id, period FROM payroll_runs WHERE company_id = ${companyId} AND status = 'draft' ORDER BY period DESC`;
  return { rows, runs };
}

/** Ledamot med arvode för stämmoperioden; arvode som lön kräver en anställd (skapas med 30 % skatt om personnumret är okänt) */
export async function addMember(actor: Actor, input: Record<string, unknown>) {
  const mode: Mode = str(input, 'mode') === 'invoice' ? 'invoice' : 'salary';
  const recipient: Recipient = str(input, 'recipient') === 'company' ? 'company' : 'person';
  const m = { mode, recipient, fSkatt: input.f_skatt === 'on', inBusiness: input.in_business === 'on' };
  const name = str(input, 'name', { required: true, label: 'Namn', max: 200 });
  const idNumber = str(input, 'id_number', { max: 20 });
  let employeeId: number | null = null;
  if (assess(m).treatment === 'salary') {
    if (recipient === 'company') throw new ValidationError('Ett bolag kan inte få lön – ange ledamoten som person');
    const pnr = normalizePersonalNumber(idNumber);
    if (!pnr) throw new ValidationError('Ange ledamotens personnummer – arvodet betalas som lön');
    const [e] = await sql<{ id: number }[]>`SELECT id FROM employees WHERE company_id = ${actor.companyId} AND personal_number = ${pnr}`;
    if (e) employeeId = e.id;
    else {
      const [first, ...rest] = name.split(' ');
      employeeId = (await createEmployee(actor, { first_name: first, last_name: rest.join(' ') || first, personal_number: pnr, monthly_salary: 0, tax_mode: 'percent', tax_percent: '30', title: 'Styrelseledamot', employment_form: 'visstid' })).id;
    }
  }
  const [r] = await sql<{ id: number }[]>`INSERT INTO board_members ${sql({ company_id: actor.companyId, name, id_number: idNumber, role: str(input, 'role', { max: 60 }) || 'ledamot', agm_date: date(input, 'agm_date', 'Årsstämma'),
    annual_fee: kronor(input.annual_fee, 'arvodet', true), mode, recipient, f_skatt: m.fSkatt, in_business: m.inBusiness, employee_id: employeeId })} RETURNING id`;
  await auditBy(sql, actor, 'create', 'board_member', r.id, { mode });
  return { id: r.id, assessment: assess(m) };
}

/** Utbetalning: som lön läggs arvodet på ledamotens lönespec i en lönekörning, mot faktura bokförs det direkt */
export async function pay(actor: Actor, memberId: number, input: Record<string, unknown>) {
  const amount = kronor(input.amount, 'beloppet');
  const d = date(input, 'date', 'Datum', false) || today();
  return sql.begin(async (tx) => {
    const [m] = await tx<Member[]>`SELECT ${COLS} FROM board_members WHERE id = ${memberId} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!m) throw new NotFoundError('Ledamoten');
    const a = assess({ mode: m.mode, recipient: m.recipient, fSkatt: m.f_skatt, inBusiness: m.in_business });
    if (a.treatment === 'salary') {
      const runId = optInt(input, 'run_id', 'Lönekörning');
      const [run] = runId ? await tx<{ id: number; status: string }[]>`SELECT id, status FROM payroll_runs WHERE id = ${runId} AND company_id = ${actor.companyId}` : [];
      if (!run || run.status !== 'draft') throw new ValidationError('Välj en lönekörning som inte är bokförd');
      if (!m.employee_id) throw new ValidationError('Ledamoten saknar anställningsuppgifter för lön');
      await tx`INSERT INTO payslips (run_id, employee_id, items, employer_fee_rate) VALUES (${run.id}, ${m.employee_id}, '[]'::jsonb, 0) ON CONFLICT DO NOTHING`;
      const [slip] = await tx<{ id: number; items: unknown[] }[]>`SELECT id, items FROM payslips WHERE run_id = ${run.id} AND employee_id = ${m.employee_id}`;
      const items = [...(slip.items ?? []), { type: 'salary', description: `Styrelsearvode ${period(m.agm_date)}`, amount }];
      await tx`UPDATE payslips SET items = ${tx.json(items as never)} WHERE id = ${slip.id}`;
      await recomputeSlip(tx, slip.id);
      await tx`INSERT INTO board_fee_payments ${tx({ company_id: actor.companyId, member_id: m.id, date: d, amount, via: 'payroll', run_id: run.id })}`;
      await auditBy(tx, actor, 'board_fee_payroll', 'board_member', m.id, { amount, run: run.id });
      return { via: 'payroll' as const, tax: 0, fee: 0, net: amount };
    }
    const [y] = await tx<{ s: number }[]>`SELECT COALESCE(SUM(amount), 0)::float8 AS s FROM board_fee_payments WHERE member_id = ${m.id} AND date >= ${`${d.slice(0, 4)}-01-01`} AND date <= ${`${d.slice(0, 4)}-12-31`}`;
    const r = invoiceLines(amount, a, y.s);
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${FEE_ACCOUNT}, 'Styrelsearvoden som inte är lön') ON CONFLICT DO NOTHING`;
    const v = await createVoucher(tx, { actor, date: d, description: `Styrelsearvode ${m.name} ${period(m.agm_date)} mot faktura`, lines: fromSigned(r.lines), sourceType: 'board_fee', sourceId: m.id });
    await tx`INSERT INTO board_fee_payments ${tx({ company_id: actor.companyId, member_id: m.id, date: d, amount, tax: r.tax, fee: r.fee, via: 'invoice', voucher_id: v.id })}`;
    await auditBy(tx, actor, 'board_fee_invoice', 'board_member', m.id, { amount, tax: r.tax });
    return { via: 'invoice' as const, ...r };
  });
}
