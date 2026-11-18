import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { lastDay } from '@/lib/assets';
import { ACCRUAL_KINDS, dueAccrualPeriods, vacationLiability, type AccrualKind } from '@/lib/accruals';
import type { Actor } from './actor';
import { dimId } from './dimensions';
import { date, int, str } from './input';
import { vacationBalances } from './absence';
import { employerFee } from '@/lib/payroll';

export interface AccrualOut {
  id: number; description: string; kind: AccrualKind; amount: number; result_account: number; balance_account: number;
  first_period: string; months: number; booked: number; last_period: string | null; source_voucher_id: number | null; cost_center_id: number | null;
}

export async function listAccruals(companyId: number): Promise<AccrualOut[]> {
  return [...await sql<AccrualOut[]>`
    SELECT a.id, a.description, a.kind, a.amount, a.result_account, a.balance_account, a.first_period, a.months, a.source_voucher_id, a.cost_center_id,
      COALESCE((SELECT SUM(p.amount) FROM accrual_postings p WHERE p.accrual_id = a.id), 0)::bigint AS booked,
      (SELECT max(p.period) FROM accrual_postings p WHERE p.accrual_id = a.id) AS last_period
    FROM accruals a WHERE a.company_id = ${companyId} ORDER BY a.first_period DESC, a.id DESC`];
}

const sign = (kind: AccrualKind) => (kind === 'prepaid_expense' ? 1 : -1);

/**
 * Lägger upp en periodisering. Med transfer_date flyttas hela beloppet först från resultatkontot till balanskontot
 * (t.ex. en årsfaktura för försäkring som bokats som kostnad), annars förutsätts beloppet redan ligga på 1790/2990.
 */
export async function createAccrual(actor: Actor, input: Record<string, unknown>) {
  const kind = str(input, 'kind') as AccrualKind;
  const k = ACCRUAL_KINDS[kind];
  if (!k) throw new ValidationError('Välj typ av periodisering');
  const amount = int(input, 'amount', 'Belopp');
  if (amount <= 0) throw new ValidationError('Beloppet måste vara större än noll');
  const resultAccount = int(input, 'result_account', 'Resultatkonto');
  if (kind === 'prepaid_expense' && (resultAccount < 4000 || resultAccount > 8999)) throw new ValidationError('Ange ett kostnadskonto (4000–8999)');
  if (kind === 'prepaid_income' && (resultAccount < 3000 || resultAccount > 3999)) throw new ValidationError('Ange ett intäktskonto (3000–3999)');
  const first = str(input, 'first_period');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(first)) throw new ValidationError('Ange första månad som ÅÅÅÅ-MM');
  const months = int(input, 'months', 'Antal månader');
  if (months < 1 || months > 120) throw new ValidationError('Antal månader ska vara 1–120');
  const transfer = date(input, 'transfer_date', 'Datum för omföring', false);
  const description = str(input, 'description', { required: true, label: 'Beskrivning' });
  const cc = dimId(input.cost_center_id);
  return sql.begin(async (tx) => {
    const [acc] = await tx`SELECT 1 FROM accounts WHERE company_id = ${actor.companyId} AND number = ${resultAccount}`;
    if (!acc) throw new ValidationError(`Konto ${resultAccount} finns inte i kontoplanen`);
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${k.balance}, ${k.balanceName}) ON CONFLICT DO NOTHING`;
    let sourceVoucherId: number | null = dimId(input.source_voucher_id);
    if (transfer) {
      const s = sign(kind);
      const v = await createVoucher(tx, {
        actor, date: transfer, description: `Periodisering: ${description}`, sourceType: 'accrual',
        lines: fromSigned([{ account: k.balance, amount: s * amount }, { account: resultAccount, amount: -s * amount, costCenterId: cc }]),
      });
      sourceVoucherId = v.id;
    }
    const [r] = await tx<{ id: number }[]>`INSERT INTO accruals ${tx({
      company_id: actor.companyId, description, kind, amount, result_account: resultAccount, balance_account: k.balance,
      first_period: first, months, source_voucher_id: sourceVoucherId, cost_center_id: cc, created_by: actor.userId,
    })} RETURNING id`;
    await auditBy(tx, actor, 'create', 'accrual', r.id);
    return r.id;
  });
}

/** Bokför periodiseringarnas månadsbelopp till och med en månad: en verifikation per månad */
export async function runAccrualsTx(tx: Tx, actor: Actor, upToPeriod: string) {
  if (!/^\d{4}-\d{2}$/.test(upToPeriod)) throw new ValidationError('Ange månad som ÅÅÅÅ-MM');
  const rows = await tx<{ id: number; description: string; kind: AccrualKind; amount: number; result_account: number; balance_account: number; first_period: string; months: number; cost_center_id: number | null }[]>`
    SELECT id, description, kind, amount, result_account, balance_account, first_period, months, cost_center_id FROM accruals
    WHERE company_id = ${actor.companyId} AND first_period <= ${upToPeriod} FOR UPDATE`;
  const byPeriod = new Map<string, { id: number; amount: number; a: (typeof rows)[number] }[]>();
  for (const a of rows) {
    const booked = new Set((await tx<{ period: string }[]>`SELECT period FROM accrual_postings WHERE accrual_id = ${a.id}`).map((x) => x.period));
    for (const p of dueAccrualPeriods(Number(a.amount), a.months, a.first_period, upToPeriod, booked)) {
      (byPeriod.get(p.period) ?? byPeriod.set(p.period, []).get(p.period)!).push({ id: a.id, amount: p.amount, a });
    }
  }
  let vouchers = 0, total = 0;
  for (const period of [...byPeriod.keys()].sort()) {
    const items = byPeriod.get(period)!;
    const v = await createVoucher(tx, {
      actor, date: lastDay(period), description: `Periodiseringar ${period}`, sourceType: 'accrual',
      lines: fromSigned(items.flatMap((i) => {
        const s = sign(i.a.kind);
        return [{ account: i.a.result_account, amount: s * i.amount, description: i.a.description, costCenterId: i.a.cost_center_id }, { account: i.a.balance_account, amount: -s * i.amount, description: i.a.description }];
      })),
    });
    for (const i of items) await tx`INSERT INTO accrual_postings (accrual_id, period, amount, voucher_id) VALUES (${i.id}, ${period}, ${i.amount}, ${v.id})`;
    vouchers++; total += items.reduce((s, i) => s + i.amount, 0);
  }
  if (vouchers) await auditBy(tx, actor, 'accrue', 'company', actor.companyId, { upTo: upToPeriod, vouchers, total });
  return { vouchers, total };
}

export async function runAccruals(actor: Actor, upToPeriod: string) {
  return sql.begin((tx) => runAccrualsTx(tx, actor, upToPeriod));
}

/** Ta bort en periodisering som inte har bokförts någon månad (omföringen rättas i så fall via verifikationen) */
export async function deleteAccrual(actor: Actor, id: number) {
  await sql.begin(async (tx) => {
    const [a] = await tx`SELECT 1 FROM accruals WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!a) throw new NotFoundError('Periodiseringen');
    const [p] = await tx`SELECT 1 FROM accrual_postings WHERE accrual_id = ${id} LIMIT 1`;
    if (p) throw new ConflictError('Periodiseringen har bokförda månader och kan inte tas bort');
    await tx`DELETE FROM accruals WHERE id = ${id}`;
    await auditBy(tx, actor, 'delete', 'accrual', id);
  });
}

/**
 * Förslag till bokslutspost för semesterlöneskuld (2920) och upplupna arbetsgivaravgifter på den (2940) per ett datum:
 * outtagna semesterdagar × 4,6 % av månadslönen, avgift efter den anställdes ålder. Justeringen är skillnaden mot bokfört saldo.
 */
export async function vacationLiabilitySuggestion(companyId: number, asOf: string) {
  const year = Number(asOf.slice(0, 4));
  const bal = await vacationBalances(companyId, year);
  const emps = new Map((await sql<{ id: number; monthly_salary: number; personal_number: string; fee_override: number | null }[]>`
    SELECT id, monthly_salary, personal_number, fee_override FROM employees WHERE company_id = ${companyId} AND active`).map((e) => [e.id, e]));
  const rows = bal.map((b) => {
    const e = emps.get(b.id)!;
    const liability = vacationLiability(Number(e.monthly_salary), b.left);
    const fee = employerFee(liability, Number(e.personal_number.slice(0, 4)), asOf, e.fee_override == null ? null : Number(e.fee_override)).fee;
    return { name: b.name, daysLeft: b.left, monthly: Number(e.monthly_salary), liability, fee };
  });
  const [cur] = await sql<{ l: number; f: number }[]>`
    SELECT COALESCE(SUM(l.credit - l.debit) FILTER (WHERE l.account_number = 2920), 0)::bigint AS l,
           COALESCE(SUM(l.credit - l.debit) FILTER (WHERE l.account_number = 2940), 0)::bigint AS f
    FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id WHERE v.company_id = ${companyId} AND v.date <= ${asOf} AND l.account_number IN (2920, 2940)`;
  const liability = rows.reduce((s, r) => s + r.liability, 0), fee = rows.reduce((s, r) => s + r.fee, 0);
  return { rows, liability, fee, booked: { liability: Number(cur.l), fee: Number(cur.f) }, adjust: { liability: liability - Number(cur.l), fee: fee - Number(cur.f) } };
}

export async function bookVacationLiability(actor: Actor, asOf: string) {
  const s = await vacationLiabilitySuggestion(actor.companyId, asOf);
  if (!s.adjust.liability && !s.adjust.fee) throw new ConflictError('Semesterlöneskulden är redan bokförd med rätt belopp');
  return sql.begin(async (tx) => {
    for (const [n, name] of [[2920, 'Upplupna semesterlöner'], [2940, 'Upplupna lagstadgade sociala och andra avgifter'], [7290, 'Förändring av semesterlöneskuld'], [7519, 'Sociala avgifter för semester- och löneskulder']] as const)
      await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${n}, ${name}) ON CONFLICT DO NOTHING`;
    const v = await createVoucher(tx, {
      actor, date: asOf, description: `Semesterlöneskuld per ${asOf}`, sourceType: 'accrual',
      lines: fromSigned([
        { account: 7290, amount: s.adjust.liability }, { account: 2920, amount: -s.adjust.liability },
        { account: 7519, amount: s.adjust.fee }, { account: 2940, amount: -s.adjust.fee },
      ].filter((l) => l.amount)),
    });
    await auditBy(tx, actor, 'vacation_liability', 'company', actor.companyId, { asOf, ...s.adjust });
    return { voucherId: v.id, ...s.adjust };
  });
}
