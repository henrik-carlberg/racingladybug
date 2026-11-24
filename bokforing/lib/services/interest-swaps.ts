import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { formatAmount, parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { INTEREST_COST, days, effectiveRate, noteText, schedule, settlement, settlementLines } from '@/lib/interest-swaps';
import type { Actor } from './actor';
import { date, optInt, str } from './input';

type Swap = { id: number; loan_id: number | null; loan: string | null; loan_rate: number | null; counterparty: string; notional: number; fixed_rate: number; floating_index: string; start_date: string; end_date: string; period_months: number };
const rate = (input: Record<string, unknown>, k: string, label: string) => { const v = Number(String(input[k] ?? '').replace(',', '.')); if (!String(input[k] ?? '').trim() || !Number.isFinite(v) || v < -5 || v >= 50) throw new ValidationError(`Ange ${label} i procent`); return v; };

export async function overview(companyId: number) {
  const swaps = await sql<Swap[]>`SELECT s.id, s.loan_id, l.name AS loan, l.rate_pct::float8 AS loan_rate, s.counterparty, s.notional::float8 AS notional, s.fixed_rate::float8 AS fixed_rate, s.floating_index,
      to_char(s.start_date,'YYYY-MM-DD') AS start_date, to_char(s.end_date,'YYYY-MM-DD') AS end_date, s.period_months
    FROM interest_swaps s LEFT JOIN loans l ON l.id = s.loan_id AND l.company_id = s.company_id WHERE s.company_id = ${companyId} ORDER BY s.end_date`;
  const ids = swaps.map((s) => s.id);
  const sets = ids.length ? await sql<{ swap_id: number; period_start: string; period_end: string; floating_rate: number; amount: number; voucher_id: number | null }[]>`SELECT swap_id, to_char(period_start,'YYYY-MM-DD') AS period_start, to_char(period_end,'YYYY-MM-DD') AS period_end, floating_rate::float8 AS floating_rate, amount::float8 AS amount, voucher_id
    FROM swap_settlements WHERE company_id = ${companyId} AND swap_id IN ${sql(ids)} ORDER BY period_start` : [];
  const vals = ids.length ? await sql<{ swap_id: number; date: string; market_value: number }[]>`SELECT swap_id, to_char(date,'YYYY-MM-DD') AS date, market_value::float8 AS market_value FROM swap_valuations WHERE company_id = ${companyId} AND swap_id IN ${sql(ids)} ORDER BY date DESC` : [];
  const loans = await sql<{ id: number; name: string; balance: number }[]>`SELECT l.id, l.name, COALESCE((SELECT r.balance FROM loan_rows r WHERE r.loan_id = l.id AND r.voucher_id IS NOT NULL ORDER BY r.n DESC LIMIT 1), l.principal)::float8 AS balance FROM loans l WHERE l.company_id = ${companyId} ORDER BY l.name`;
  const t = today();
  return {
    loans,
    swaps: swaps.map((s) => {
      const own = sets.filter((x) => x.swap_id === s.id);
      const next = schedule(s.start_date, s.end_date, s.period_months).find((p) => !own.some((x) => x.period_start === p.start));
      const last = own[own.length - 1];
      const mv = vals.find((v) => v.swap_id === s.id) ?? null;
      const loan = loans.find((l) => l.id === s.loan_id);
      return { ...s, settlements: own, next: next ?? null, nextDue: !!next && next.end <= t, net: own.reduce((a, x) => a + x.amount, 0), valuation: mv,
        effective: s.loan_rate != null && last && loan ? effectiveRate(s.loan_rate, last.floating_rate, s.fixed_rate, s.notional, loan.balance) : null,
        note: noteText(s, mv?.market_value ?? null, mv?.date ?? null, formatAmount) };
    }),
  };
}

export async function add(actor: Actor, input: Record<string, unknown>) {
  const notional = parseAmount(String(input.notional ?? '').trim());
  if (notional == null || notional <= 0) throw new ValidationError('Ange nominellt belopp');
  const loanId = optInt(input, 'loan_id');
  if (loanId) { const [l] = await sql`SELECT 1 FROM loans WHERE id = ${loanId} AND company_id = ${actor.companyId}`; if (!l) throw new NotFoundError('Lånet'); }
  const months = optInt(input, 'period_months') ?? 3;
  if (![1, 3, 6, 12].includes(months)) throw new ValidationError('Ogiltig avräkningsperiod');
  const start = date(input, 'start_date', 'Startdag'), end = date(input, 'end_date', 'Slutdag');
  if (end <= start) throw new ValidationError('Slutdagen ska vara efter startdagen');
  const [r] = await sql<{ id: number }[]>`INSERT INTO interest_swaps ${sql({ company_id: actor.companyId, loan_id: loanId ?? null, counterparty: str(input, 'counterparty', { required: true, label: 'Motpart', max: 100 }), notional, fixed_rate: rate(input, 'fixed_rate', 'fast ränta'),
    floating_index: str(input, 'floating_index', { max: 40 }) || 'STIBOR 3M', start_date: start, end_date: end, period_months: months, created_by: actor.userId })} RETURNING id`;
  await auditBy(sql, actor, 'interest_swap', 'interest_swap', r.id, { notional });
  return r.id;
}

/** Avräkning av nästa period med periodens fixing av den rörliga räntan */
export async function settle(actor: Actor, id: number, input: Record<string, unknown>) {
  const floating = rate(input, 'floating_rate', 'den rörliga räntan (fixing)');
  return sql.begin(async (tx) => {
    const [s] = await tx<Swap[]>`SELECT id, counterparty, notional::float8 AS notional, fixed_rate::float8 AS fixed_rate, floating_index, to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date, period_months
      FROM interest_swaps WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!s) throw new NotFoundError('Swappen');
    const done = await tx<{ period_start: string }[]>`SELECT to_char(period_start,'YYYY-MM-DD') AS period_start FROM swap_settlements WHERE swap_id = ${id}`;
    const p = schedule(s.start_date, s.end_date, s.period_months).find((x) => !done.some((d) => d.period_start === x.start));
    if (!p) throw new ConflictError('Alla perioder är avräknade');
    if (p.end > today()) throw new ValidationError(`Perioden ${p.start}–${p.end} är inte slut än`);
    const amount = settlement(s.notional, s.fixed_rate, floating, days(p.start, p.end));
    let voucherId: number | null = null;
    if (amount) {
      await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${INTEREST_COST}, 'Räntekostnader för långfristiga skulder') ON CONFLICT DO NOTHING`;
      voucherId = (await createVoucher(tx, { actor, date: p.end, description: `Ränteswap ${s.counterparty} ${p.start}–${p.end}: ${s.floating_index} ${floating.toLocaleString('sv-SE')} % mot fast ${s.fixed_rate.toLocaleString('sv-SE')} %`, lines: fromSigned(settlementLines(amount)), sourceType: 'interest_swap', sourceId: id })).id;
    }
    await tx`INSERT INTO swap_settlements ${tx({ swap_id: id, company_id: actor.companyId, period_start: p.start, period_end: p.end, floating_rate: floating, amount, voucher_id: voucherId, created_by: actor.userId })}`;
    return { amount, period: `${p.start}–${p.end}` };
  });
}

/** Marknadsvärde enligt bankens besked (t.ex. på balansdagen) – lämnas som upplysning, bokförs inte */
export async function value(actor: Actor, id: number, input: Record<string, unknown>) {
  const [s] = await sql`SELECT 1 FROM interest_swaps WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!s) throw new NotFoundError('Swappen');
  const raw = String(input.market_value ?? '').trim();
  const neg = raw.startsWith('-');
  const mv = parseAmount(neg ? raw.slice(1) : raw);
  if (mv == null) throw new ValidationError('Ange marknadsvärdet (negativt om swappen är en skuld)');
  const d = date(input, 'date', 'Värderingsdag');
  await sql`INSERT INTO swap_valuations (swap_id, company_id, date, market_value) VALUES (${id}, ${actor.companyId}, ${d}, ${neg ? -mv : mv}) ON CONFLICT (swap_id, date) DO UPDATE SET market_value = EXCLUDED.market_value`;
  return neg ? -mv : mv;
}
