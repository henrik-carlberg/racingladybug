import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { addDays, today } from '@/lib/format';
import { parseAmount } from '@/lib/money';
import { DEFAULT_BASE_RATE, COST_ACCOUNT, INCOME_ACCOUNT, TAX_ACCOUNT, interest, interestLines, monthDays } from '@/lib/tax-interest';
import type { Actor } from './actor';
import { date, str } from './input';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

async function baseRate(companyId: number) {
  const [s] = await sql<{ base_rate: number }[]>`SELECT base_rate FROM tax_interest_settings WHERE company_id = ${companyId}`;
  return s?.base_rate ?? DEFAULT_BASE_RATE;
}

const active = (companyId: number) => sql<{ id: number; amount: number; start: string; end: string; note: string; ended: string | null }[]>`
  SELECT id, amount::float8 AS amount, to_char(start_date,'YYYY-MM-DD') AS start, to_char(end_date,'YYYY-MM-DD') AS end, note, to_char(ended_at,'YYYY-MM-DD') AS ended
  FROM tax_deferrals WHERE company_id = ${companyId} ORDER BY end_date`;

/** Saldot på 1630 och anstånd dag för dag i månaden */
async function days(companyId: number, period: string) {
  const ds = monthDays(period);
  const [{ ob }] = await sql<{ ob: number }[]>`SELECT COALESCE(SUM(l.debit - l.credit), 0)::float8 AS ob FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${companyId} AND l.account_number = ${TAX_ACCOUNT} AND v.date < ${ds[0]}`;
  const moves = new Map((await sql<{ d: string; s: number }[]>`SELECT to_char(v.date,'YYYY-MM-DD') AS d, SUM(l.debit - l.credit)::float8 AS s FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${companyId} AND l.account_number = ${TAX_ACCOUNT} AND v.date BETWEEN ${ds[0]} AND ${ds[ds.length - 1]}
      AND v.source_type IS DISTINCT FROM 'tax_interest' GROUP BY v.date`).map((r) => [r.d, r.s]));
  const defs = await active(companyId);
  let bal = ob;
  return ds.map((d) => {
    bal += moves.get(d) ?? 0;
    // Anståndet gäller från startdagen till och med slutdagen (eller dagen före det avslutades)
    const deferred = defs.filter((x) => x.start <= d && d <= x.end && (!x.ended || d < x.ended)).reduce((s, x) => s + x.amount, 0);
    return { date: d, balance: bal, deferred };
  });
}

const booked = (companyId: number, period: string) => sql<{ id: number; voucher_id: number; cost: number; income: number }[]>`
  SELECT b.id, b.voucher_id, b.cost::float8 AS cost, b.income::float8 AS income FROM tax_interest_bookings b
  WHERE b.company_id = ${companyId} AND b.period = ${period} AND NOT EXISTS (SELECT 1 FROM vouchers r WHERE r.corrects_id = b.voucher_id)`;

/** Räntan för en månad, och om Skatteverkets räntor redan har bokförts från den inlästa skattekontofilen */
export async function interestPreview(companyId: number, period: string) {
  if (!PERIOD.test(period)) throw new ValidationError('Ange månaden som ÅÅÅÅ-MM');
  const base = await baseRate(companyId);
  const d = await days(companyId, period);
  const r = interest(d, base);
  const [b] = await booked(companyId, period);
  const [{ imported }] = await sql<{ imported: number }[]>`SELECT count(*)::int AS imported FROM tax_account_entries WHERE company_id = ${companyId}
    AND status = 'booked' AND to_char(date,'YYYY-MM') = ${period} AND text ILIKE '%ränta%'`;
  return { period, base, ...r, booked: b ?? null, imported, lowest: Math.min(...d.map((x) => x.balance + x.deferred)), ended: monthDays(period).pop()! < today() };
}

export async function setBaseRate(actor: Actor, input: Record<string, unknown>) {
  const s = String(input.base_rate ?? '').trim().replace(',', '.').replace('%', '');
  const v = Math.round(Number(s) * 100);
  if (!s || !Number.isFinite(v) || v < 0 || v > 2000) throw new ValidationError('Ange basräntan i procent, t.ex. 2,75');
  await sql`INSERT INTO tax_interest_settings (company_id, base_rate) VALUES (${actor.companyId}, ${v}) ON CONFLICT (company_id) DO UPDATE SET base_rate = EXCLUDED.base_rate`;
  await auditBy(sql, actor, 'tax_base_rate', 'company', actor.companyId, { base_rate: v });
  return v;
}

/** Bokför månadens ränta på sista dagen i månaden */
export async function bookInterest(actor: Actor, period: string) {
  if (!PERIOD.test(period)) throw new ValidationError('Ange månaden som ÅÅÅÅ-MM');
  const last = monthDays(period).pop()!;
  if (last >= today()) throw new ValidationError('Räntan kan bokföras först när månaden är slut');
  return sql.begin(async (tx) => {
    await tx`SELECT 1 FROM companies WHERE id = ${actor.companyId} FOR UPDATE`;
    const p = await interestPreview(actor.companyId, period);
    if (p.booked) throw new ConflictError(`Räntan för ${period} är redan bokförd`);
    if (p.imported) throw new ConflictError(`Räntan för ${period} är redan bokförd från skattekontofilen`);
    if (!p.cost && !p.income) throw new ValidationError('Ingen ränta att bokföra för månaden');
    for (const [n, name] of [[COST_ACCOUNT, 'Räntekostnader för skatter och avgifter'], [INCOME_ACCOUNT, 'Skattefria ränteintäkter']] as const)
      await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${n}, ${name}) ON CONFLICT DO NOTHING`;
    const v = await createVoucher(tx, { actor, date: last, description: `Ränta på skattekontot ${period}`, sourceType: 'tax_interest', sourceId: null, lines: fromSigned(interestLines(p.cost, p.income)) });
    await tx`INSERT INTO tax_interest_bookings ${tx({ company_id: actor.companyId, period, cost: p.cost, income: p.income, voucher_id: v.id, created_by: actor.userId })}`;
    await auditBy(tx, actor, 'tax_interest', 'voucher', v.id, { period, cost: p.cost, income: p.income });
    return p;
  });
}

export async function deferrals(companyId: number) {
  const t = today();
  return (await active(companyId)).map((d) => ({ ...d, status: d.ended ? 'ended' as const : d.end < t ? 'expired' as const : d.end <= addDays(t, 14) ? 'soon' as const : 'active' as const }));
}

/** Anstånd med inbetalning av skatt: beloppet ska betalas senast slutdagen */
export async function addDeferral(actor: Actor, input: Record<string, unknown>) {
  const amount = parseAmount(String(input.amount ?? ''));
  if (amount == null || amount <= 0) throw new ValidationError('Ange anståndsbeloppet');
  const start = date(input, 'start_date', 'Startdatum'), end = date(input, 'end_date', 'Slutdatum');
  if (end < start) throw new ValidationError('Slutdatum måste vara efter startdatum');
  const [r] = await sql<{ id: number }[]>`INSERT INTO tax_deferrals ${sql({ company_id: actor.companyId, amount, start_date: start, end_date: end, note: str(input, 'note', { max: 300 }), created_by: actor.userId })} RETURNING id`;
  await auditBy(sql, actor, 'tax_deferral', 'tax_deferral', r.id, { amount, start, end });
  return r.id;
}

/** Anståndet är betalt eller har upphört */
export async function endDeferral(actor: Actor, id: number, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum');
  const r = await sql`UPDATE tax_deferrals SET ended_at = ${d} WHERE id = ${id} AND company_id = ${actor.companyId} AND ended_at IS NULL AND start_date <= ${d} RETURNING id`;
  if (!r.length) throw new NotFoundError('Anståndet');
  await auditBy(sql, actor, 'tax_deferral_ended', 'tax_deferral', id, { date: d });
}
