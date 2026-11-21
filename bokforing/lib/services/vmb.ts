import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { ACC } from '@/lib/bas';
import { SIMPLE_LIMIT, VMB, settle, settleLines } from '@/lib/vmb';
import type { Actor } from './actor';
import { date, str } from './input';
import { today } from '@/lib/format';

/** VMB-inköp och försäljningar får inte dateras i en period som redan är avräknad (då skulle de aldrig beskattas) */
async function assertOpen(tx: Tx, companyId: number, d: string) {
  await tx`SELECT pg_advisory_xact_lock(hashtext('vmb'), ${companyId})`;
  const [last] = await tx<{ to: string }[]>`SELECT to_char(max(period_to),'YYYY-MM-DD') AS "to" FROM vmb_settlements WHERE company_id = ${companyId}`;
  if (last?.to && d <= last.to) throw new ValidationError(`VMB är avräknad till och med ${last.to}; datera inköp och försäljningar efter det`);
}

const kronor = (v: unknown, label: string) => { const n = parseAmount(String(v ?? '').trim()); if (n == null || n <= 0) throw new ValidationError(`Ange ${label} i kronor`); return n; };
async function ensure(db: Tx | typeof sql, companyId: number) {
  for (const [n, name] of [[VMB.sales, 'Försäljning av varor, vinstmarginalbeskattning'], [VMB.base, 'Försäljning VMB, beskattningsunderlag'], [VMB.purchases, 'Inköp av varor för vinstmarginalbeskattning']] as const)
    await db`INSERT INTO accounts (company_id, number, name) VALUES (${companyId}, ${n}, ${name}) ON CONFLICT DO NOTHING`;
}

/** Periodens VMB-försäljning (inkl. moms) och VMB-inköp enligt huvudboken, utan tidigare avräkningar */
async function totals(db: Tx | typeof sql, companyId: number, from: string, to: string) {
  const [r] = await db<{ sales: number; purchases: number }[]>`SELECT
    COALESCE(SUM(CASE WHEN l.account_number = ${VMB.sales} THEN l.credit - l.debit END), 0)::float8 AS sales,
    COALESCE(SUM(CASE WHEN l.account_number = ${VMB.purchases} THEN l.debit - l.credit END), 0)::float8 AS purchases
    FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${companyId} AND v.date BETWEEN ${from} AND ${to} AND v.source_type IS DISTINCT FROM 'vmb'`;
  return r;
}

export async function overview(companyId: number) {
  const settlements = await sql<{ id: number; period_from: string; period_to: string; sales: number; purchases: number; carried_in: number; margin: number; vat: number; carry_out: number }[]>`
    SELECT id, to_char(period_from,'YYYY-MM-DD') AS period_from, to_char(period_to,'YYYY-MM-DD') AS period_to, sales::float8 AS sales, purchases::float8 AS purchases,
      carried_in::float8 AS carried_in, margin::float8 AS margin, vat::float8 AS vat, carry_out::float8 AS carry_out FROM vmb_settlements WHERE company_id = ${companyId} ORDER BY period_to DESC`;
  return { settlements, carry: settlements[0]?.carry_out ?? 0, nextFrom: settlements[0] ? nextDay(settlements[0].period_to) : null };
}
const nextDay = (d: string) => new Date(Date.parse(d) + 864e5).toISOString().slice(0, 10);

/** Inköp av en vara för vidareförsäljning med VMB (ingen ingående moms får dras av) */
export async function purchase(actor: Actor, input: Record<string, unknown>) {
  const price = kronor(input.price, 'inköpspriset');
  if (price > SIMPLE_LIMIT) throw new ValidationError('Förenklad metod gäller varor med inköpspris högst 50 000 kr. Dyrare varor beskattas med marginalen per vara.');
  const d = date(input, 'date', 'Datum');
  const what = str(input, 'description', { required: true, label: 'Vara', max: 200 });
  return sql.begin(async (tx) => {
    await assertOpen(tx, actor.companyId, d);
    await ensure(tx, actor.companyId);
    await createVoucher(tx, { actor, date: d, description: `VMB-inköp: ${what}`, lines: fromSigned([{ account: VMB.purchases, amount: price }, { account: ACC.bank, amount: -price }]), sourceType: 'vmb_purchase' });
    await auditBy(tx, actor, 'vmb_purchase', 'company', actor.companyId, { price });
  });
}

/** Försäljning av en VMB-vara. Fakturan/kvittot får inte visa momsen; texten "Vinstmarginalbeskattning för begagnade varor" ska anges. */
export async function sale(actor: Actor, input: Record<string, unknown>) {
  const price = kronor(input.price, 'försäljningspriset');
  const d = date(input, 'date', 'Datum');
  const what = str(input, 'description', { required: true, label: 'Vara', max: 200 });
  return sql.begin(async (tx) => {
    await assertOpen(tx, actor.companyId, d);
    await ensure(tx, actor.companyId);
    await createVoucher(tx, { actor, date: d, description: `VMB-försäljning: ${what} (Vinstmarginalbeskattning för begagnade varor)`, lines: fromSigned([{ account: ACC.bank, amount: price }, { account: VMB.sales, amount: -price }]), sourceType: 'vmb_sale' });
    await auditBy(tx, actor, 'vmb_sale', 'company', actor.companyId, { price });
  });
}

/** Avräkning för en period: moms på den positiva marginalen, eller negativ marginal som förs över till nästa period */
export async function settlePeriod(actor: Actor, input: Record<string, unknown>) {
  const from = date(input, 'period_from', 'Från'), to = date(input, 'period_to', 'Till');
  if (to < from) throw new ValidationError('Perioden slutar före den börjar');
  if (to > today()) throw new ValidationError('En period kan bara avräknas när den är slut');
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('vmb'), ${actor.companyId})`;
    const [last] = await tx<{ period_to: string; carry_out: number }[]>`SELECT to_char(period_to,'YYYY-MM-DD') AS period_to, carry_out::float8 AS carry_out FROM vmb_settlements
      WHERE company_id = ${actor.companyId} ORDER BY period_to DESC LIMIT 1`;
    if (last && from <= last.period_to) throw new ConflictError(`Perioden överlappar en avräknad period (till och med ${last.period_to})`);
    if (last && from !== nextDay(last.period_to)) throw new ValidationError(`Nästa period börjar ${nextDay(last.period_to)}`);
    const t = await totals(tx, actor.companyId, from, to);
    const r = settle({ sales: t.sales, purchases: t.purchases, carriedIn: last?.carry_out ?? 0 });
    await ensure(tx, actor.companyId);
    const lines = settleLines(r.vat, r.base);
    const v = lines.length ? await createVoucher(tx, { actor, date: to, description: `Vinstmarginalbeskattning ${from} – ${to}`, lines: fromSigned(lines), sourceType: 'vmb' }) : null;
    await tx`INSERT INTO vmb_settlements ${tx({ company_id: actor.companyId, period_from: from, period_to: to, sales: t.sales, purchases: t.purchases, carried_in: last?.carry_out ?? 0,
      margin: r.margin, vat: r.vat, carry_out: r.carryOut, voucher_id: v?.id ?? null, created_by: actor.userId })}`;
    await auditBy(tx, actor, 'vmb_settle', 'company', actor.companyId, { from, to, vat: r.vat });
    return r;
  });
}
