import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { COST, LIABILITY, paymentLines, SLP_COST, SLP_DEBT, taxAdjustment, valuation, valuationLines } from '@/lib/direct-pension';
import type { Actor } from './actor';
import { date, str } from './input';

const NAMES: Record<number, string> = { [LIABILITY]: 'Avsättningar för pensioner enligt tryggandelagen', [COST]: 'Förändring av pensionsskuld', [SLP_COST]: 'Särskild löneskatt för pensionskostnader', [SLP_DEBT]: 'Beräknad särskild löneskatt på pensionskostnader' };
async function ensure(tx: Tx, companyId: number) { for (const [n, name] of Object.entries(NAMES)) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${companyId}, ${Number(n)}, ${name}) ON CONFLICT DO NOTHING`; }
const kronor = (v: unknown, label: string, zero = false) => { const n = parseAmount(String(v ?? '').trim() || (zero ? '0' : '')); if (n == null || n < 0 || (!zero && !n)) throw new ValidationError(`Ange ${label} i kronor`); return n; };

export async function overview(companyId: number, year: number) {
  const cs = await sql<{ id: number; person: string; description: string; insured: boolean }[]>`SELECT id, person, description, insured FROM pension_commitments WHERE company_id = ${companyId} ORDER BY person`;
  const rows = [];
  for (const c of cs) {
    const [x] = await sql<{ liability: number; year_change: number; entries: number }[]>`SELECT COALESCE(SUM(change), 0)::float8 AS liability,
      COALESCE(SUM(change) FILTER (WHERE kind = 'valuation' AND date BETWEEN ${`${year}-01-01`} AND ${`${year}-12-31`}), 0)::float8 AS year_change, count(*)::int AS entries FROM pension_entries WHERE commitment_id = ${c.id}`;
    rows.push({ ...c, liability: x.liability, yearChange: x.year_change, nonDeductible: taxAdjustment(x.year_change, c.insured) });
  }
  return { rows, total: rows.reduce((s, r) => s + r.liability, 0), nonDeductible: rows.reduce((s, r) => s + r.nonDeductible, 0) };
}

export async function addCommitment(actor: Actor, input: Record<string, unknown>) {
  const [r] = await sql<{ id: number }[]>`INSERT INTO pension_commitments ${sql({ company_id: actor.companyId, person: str(input, 'person', { required: true, label: 'Person', max: 200 }), description: str(input, 'description', { max: 300 }), insured: input.insured === 'on' })} RETURNING id`;
  await auditBy(sql, actor, 'create', 'pension_commitment', r.id);
  return r.id;
}

async function liability(tx: Tx, commitmentId: number) {
  const [x] = await tx<{ l: number }[]>`SELECT COALESCE(SUM(change), 0)::float8 AS l FROM pension_entries WHERE commitment_id = ${commitmentId}`;
  return x.l;
}

/** Årlig uppräkning till kapitalvärdet (enligt PRI eller försäkringstekniska grunder) med särskild löneskatt på förändringen */
export async function valuate(actor: Actor, id: number, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Värderingsdag');
  const capital = kronor(input.capital_value, 'kapitalvärdet', true);
  return sql.begin(async (tx) => {
    const [c] = await tx<{ person: string }[]>`SELECT person FROM pension_commitments WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!c) throw new NotFoundError('Pensionsåtagandet');
    const v = valuation(await liability(tx, id), capital);
    if (!v.change) throw new ValidationError('Kapitalvärdet är oförändrat');
    await ensure(tx, actor.companyId);
    const vo = await createVoucher(tx, { actor, date: d, description: `Pensionsskuld ${c.person} enligt tryggandelagen: ${v.change > 0 ? 'ökning' : 'minskning'}`, lines: fromSigned(valuationLines(v.change, v.slp)), sourceType: 'direct_pension', sourceId: id });
    await tx`INSERT INTO pension_entries ${tx({ company_id: actor.companyId, commitment_id: id, kind: 'valuation', date: d, capital_value: capital, change: v.change, slp: v.slp, voucher_id: vo.id })}`;
    await auditBy(tx, actor, 'pension_valuation', 'pension_commitment', id, v);
    return v;
  });
}

/** Utbetald pension minskar skulden */
export async function payPension(actor: Actor, id: number, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum');
  const amount = kronor(input.amount, 'beloppet');
  return sql.begin(async (tx) => {
    const [c] = await tx<{ person: string }[]>`SELECT person FROM pension_commitments WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!c) throw new NotFoundError('Pensionsåtagandet');
    if (amount > await liability(tx, id)) throw new ValidationError('Utbetalningen är större än pensionsskulden');
    await ensure(tx, actor.companyId);
    const vo = await createVoucher(tx, { actor, date: d, description: `Utbetald pension ${c.person} (minskar pensionsskulden)`, lines: fromSigned(paymentLines(amount)), sourceType: 'direct_pension', sourceId: id });
    await tx`INSERT INTO pension_entries ${tx({ company_id: actor.companyId, commitment_id: id, kind: 'payment', date: d, change: -amount, voucher_id: vo.id })}`;
    await auditBy(tx, actor, 'pension_payment', 'pension_commitment', id, { amount });
    return amount;
  });
}

/** Rörelser för noten Avsättningar för pensioner */
export async function pensionNote(companyId: number, from: string, to: string) {
  const cs = await sql<{ id: number; person: string }[]>`SELECT id, person FROM pension_commitments WHERE company_id = ${companyId}`;
  const out = [];
  for (const c of cs) {
    const [x] = await sql<{ opening: number; set: number; used: number; released: number }[]>`SELECT
      COALESCE(SUM(change) FILTER (WHERE date < ${from}), 0)::float8 AS opening,
      COALESCE(SUM(change) FILTER (WHERE date BETWEEN ${from} AND ${to} AND kind = 'valuation' AND change > 0), 0)::float8 AS set,
      COALESCE(-SUM(change) FILTER (WHERE date BETWEEN ${from} AND ${to} AND kind = 'payment'), 0)::float8 AS used,
      COALESCE(-SUM(change) FILTER (WHERE date BETWEEN ${from} AND ${to} AND kind = 'valuation' AND change < 0), 0)::float8 AS released
      FROM pension_entries WHERE commitment_id = ${c.id}`;
    const closing = x.opening + x.set - x.used - x.released;
    if (x.opening || x.set || x.used || x.released) out.push({ label: 'Pensioner enligt tryggandelagen', description: c.person, ...x, closing });
  }
  return out;
}
