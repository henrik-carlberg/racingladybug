import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { LIVESTOCK, LIVESTOCK_CHANGE, SUBSIDY_INCOME, SUBSIDY_RECEIVABLE, changeLines, paymentLines, receivableLines, valuation } from '@/lib/farming';
import type { Actor } from './actor';
import { date, int, str } from './input';

const NAMES: Record<number, string> = { [SUBSIDY_RECEIVABLE]: 'Fordringar på EU-stöd och ersättningar', [SUBSIDY_INCOME]: 'Erhållna EU-bidrag', [LIVESTOCK]: 'Lager av färdiga varor (djur)', [LIVESTOCK_CHANGE]: 'Förändring av lager av färdiga varor' };
const ensure = async (tx: Tx, companyId: number, ns: number[]) => { for (const n of ns) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${companyId}, ${n}, ${NAMES[n]}) ON CONFLICT DO NOTHING`; };
const kr = (v: unknown, label: string, zero = false) => { const n = parseAmount(String(v ?? '').trim() || (zero ? '0' : '')); if (n == null || n < 0 || (!zero && !n)) throw new ValidationError(`Ange ${label} i kronor`); return n; };

export async function overview(companyId: number) {
  const subsidies = await sql<{ id: number; kind: string; year: number; applied: number; booked: number; paid: number; status: string; paid_on: string | null }[]>`
    SELECT id, kind, year, applied::float8 AS applied, booked::float8 AS booked, paid::float8 AS paid, status, to_char(paid_on,'YYYY-MM-DD') AS paid_on FROM farm_subsidies WHERE company_id = ${companyId} ORDER BY year DESC, kind`;
  const types = await sql<{ id: number; name: string; value_per_head: number }[]>`SELECT id, name, value_per_head::float8 AS value_per_head FROM livestock_types WHERE company_id = ${companyId} ORDER BY name`;
  const valuations = await sql<{ date: string; counts: { type: string; heads: number; value_per_head: number; value: number }[]; value: number; change: number }[]>`
    SELECT to_char(date,'YYYY-MM-DD') AS date, counts, value::float8 AS value, change::float8 AS change FROM livestock_valuations WHERE company_id = ${companyId} ORDER BY date DESC LIMIT 10`;
  const [{ receivable }] = await sql<{ receivable: number }[]>`SELECT COALESCE(SUM(l.debit - l.credit), 0)::float8 AS receivable FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id WHERE v.company_id = ${companyId} AND l.account_number = ${SUBSIDY_RECEIVABLE}`;
  return { subsidies, types, valuations, receivable };
}

export async function addSubsidy(actor: Actor, input: Record<string, unknown>) {
  const year = int(input, 'year', 'Stödår');
  if (year < 2000 || year > 2100) throw new ValidationError('Ogiltigt stödår');
  try {
    await sql`INSERT INTO farm_subsidies ${sql({ company_id: actor.companyId, kind: str(input, 'kind', { required: true, label: 'Stöd', max: 100 }), year, applied: kr(input.applied, 'sökt belopp'), created_by: actor.userId })}`;
  } catch (e) { if (String((e as Error).message).includes('farm_subsidies_company_id_kind_year_key')) throw new ConflictError('Stödet finns redan för året'); throw e; }
}

const lock = async (tx: Tx, actor: Actor, id: number) => {
  const [s] = await tx<{ kind: string; year: number; applied: number; booked: number; status: string }[]>`SELECT kind, year, applied::float8 AS applied, booked::float8 AS booked, status FROM farm_subsidies WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
  if (!s) throw new NotFoundError('Stödet');
  return s;
};

/** Fordran för det år stödet avser – beviljat belopp, eller sökt belopp som bästa uppskattning i bokslutet */
export async function book(actor: Actor, id: number, input: Record<string, unknown>) {
  return sql.begin(async (tx) => {
    const s = await lock(tx, actor, id);
    if (s.status !== 'applied') throw new ConflictError('Stödet är redan bokfört');
    const amount = String(input.amount ?? '').trim() ? kr(input.amount, 'beviljat belopp') : s.applied;
    await ensure(tx, actor.companyId, [SUBSIDY_RECEIVABLE, SUBSIDY_INCOME]);
    const v = await createVoucher(tx, { actor, date: `${s.year}-12-31`, description: `${s.kind} ${s.year}: fordran`, lines: fromSigned(receivableLines(amount)), sourceType: 'farming', sourceId: id });
    await tx`UPDATE farm_subsidies SET status = 'booked', booked = ${amount}, booked_voucher_id = ${v.id} WHERE id = ${id}`;
    return amount;
  });
}

/** Utbetalningen: fordran löses upp och en skillnad justerar intäkten */
export async function pay(actor: Actor, id: number, input: Record<string, unknown>) {
  const amount = kr(input.amount, 'utbetalt belopp'), d = date(input, 'date', 'Datum');
  return sql.begin(async (tx) => {
    const s = await lock(tx, actor, id);
    if (s.status === 'paid') throw new ConflictError('Stödet är redan utbetalt');
    await ensure(tx, actor.companyId, [SUBSIDY_RECEIVABLE, SUBSIDY_INCOME]);
    const v = await createVoucher(tx, { actor, date: d, description: `${s.kind} ${s.year}: utbetalning`, lines: fromSigned(paymentLines(amount, s.booked)), sourceType: 'farming', sourceId: id });
    await tx`UPDATE farm_subsidies SET status = 'paid', paid = ${amount}, paid_on = ${d}, paid_voucher_id = ${v.id} WHERE id = ${id}`;
    await auditBy(tx, actor, 'farm_subsidy_paid', 'farm_subsidy', id, { amount, booked: s.booked });
    return { amount, diff: amount - s.booked };
  });
}

export async function saveType(actor: Actor, input: Record<string, unknown>) {
  const v = kr(input.value_per_head, 'värdet per djur', true);
  await sql`INSERT INTO livestock_types (company_id, name, value_per_head) VALUES (${actor.companyId}, ${str(input, 'name', { required: true, label: 'Djurslag', max: 100 })}, ${v})
    ON CONFLICT (company_id, name) DO UPDATE SET value_per_head = EXCLUDED.value_per_head`;
}

/** Djurinventering per datum (normalt bokslutsdagen): värdet bokförs som lager och förändringen mot förra inventeringen som lagerförändring */
export async function count(actor: Actor, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Inventeringsdag');
  return sql.begin(async (tx) => {
    await tx`SELECT id FROM companies WHERE id = ${actor.companyId} FOR UPDATE`;
    const [dup] = await tx`SELECT 1 FROM livestock_valuations WHERE company_id = ${actor.companyId} AND date = ${d}`;
    if (dup) throw new ConflictError('Det finns redan en inventering för dagen');
    const [later] = await tx`SELECT 1 FROM livestock_valuations WHERE company_id = ${actor.companyId} AND date > ${d}`;
    if (later) throw new ConflictError('Det finns en senare inventering');
    const types = await tx<{ id: number; name: string; value_per_head: number }[]>`SELECT id, name, value_per_head::float8 AS value_per_head FROM livestock_types WHERE company_id = ${actor.companyId}`;
    const counts = types.map((t) => {
      const n = Number(String(input[`heads_${t.id}`] ?? '').trim() || '0');
      if (!Number.isInteger(n) || n < 0) throw new ValidationError(`Ogiltigt antal ${t.name}`);
      return { type: t.name, heads: n, value_per_head: t.value_per_head };
    });
    const val = valuation(counts);
    const [prev] = await tx<{ value: number }[]>`SELECT value::float8 AS value FROM livestock_valuations WHERE company_id = ${actor.companyId} ORDER BY date DESC LIMIT 1`;
    const change = val.value - (prev?.value ?? 0);
    let voucherId: number | null = null;
    if (change) {
      await ensure(tx, actor.companyId, [LIVESTOCK, LIVESTOCK_CHANGE]);
      voucherId = (await createVoucher(tx, { actor, date: d, description: `Djurinventering ${d}: ${val.rows.map((r) => `${r.heads} ${r.type}`).join(', ') || 'inga djur'}`, lines: fromSigned(changeLines(change)), sourceType: 'farming' })).id;
    }
    await tx`INSERT INTO livestock_valuations ${tx({ company_id: actor.companyId, date: d, counts: tx.json(val.rows), value: val.value, change, voucher_id: voucherId, created_by: actor.userId })}`;
    return { value: val.value, change };
  });
}
