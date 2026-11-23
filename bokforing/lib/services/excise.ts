import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { LIABILITY, bookingLines, computeReturn, dueDate, parseRate, paymentLines, type TypeBasis } from '@/lib/excise';
import type { Actor } from './actor';
import { date, int, str } from './input';

type Db = Tx | typeof sql;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const bounds = (period: string) => { const [y, m] = period.split('-').map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return [`${period}-01`, `${period}-${String(last).padStart(2, '0')}`] as const; };
const qtyOf = (v: unknown, label: string) => { const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')); if (!Number.isFinite(n) || n === 0 || Math.round(n * 1000) !== n * 1000) throw new ValidationError(`Ange ${label}`); return n; };

/** Underlaget per skatteslag för en månad: levererat ur lagret (minus returer tillbaka i lager) × faktor plus egna uttag */
async function basis(db: Db, companyId: number, period: string): Promise<TypeBasis[]> {
  const [from, to] = bounds(period);
  return db<TypeBasis[]>`SELECT t.id, t.name, t.unit, t.rate::float8 AS rate, t.cost_account,
      COALESCE((SELECT SUM(-m.qty * ep.factor) FROM excise_products ep JOIN inv_movements m ON m.product_id = ep.product_id
        WHERE ep.excise_type_id = t.id AND m.company_id = ${companyId} AND m.date BETWEEN ${from} AND ${to} AND (m.type = 'delivery' OR (m.ref_type = 'return_case' AND m.qty > 0))), 0)::float8 AS delivered,
      COALESCE((SELECT SUM(e.quantity) FROM excise_entries e WHERE e.excise_type_id = t.id AND e.date BETWEEN ${from} AND ${to}), 0)::float8 AS manual
    FROM excise_types t WHERE t.company_id = ${companyId} AND t.active ORDER BY t.name`;
}

export async function overview(companyId: number, period: string) {
  if (!PERIOD.test(period)) throw new ValidationError('Ogiltig period');
  const types = await sql<{ id: number; name: string; unit: string; rate: number; cost_account: number; invoice_line: boolean }[]>`SELECT id, name, unit, rate::float8 AS rate, cost_account, invoice_line FROM excise_types WHERE company_id = ${companyId} AND active ORDER BY name`;
  const links = await sql<{ excise_type_id: number; product_id: number; product: string; factor: number }[]>`SELECT ep.excise_type_id, ep.product_id, p.sku || ' ' || p.name AS product, ep.factor::float8 AS factor
    FROM excise_products ep JOIN excise_types t ON t.id = ep.excise_type_id JOIN inv_products p ON p.id = ep.product_id WHERE t.company_id = ${companyId} ORDER BY p.sku`;
  const [from, to] = bounds(period);
  const entries = await sql<{ id: number; type: string; date: string; quantity: number; note: string }[]>`SELECT e.id, t.name AS type, to_char(e.date,'YYYY-MM-DD') AS date, e.quantity::float8 AS quantity, e.note
    FROM excise_entries e JOIN excise_types t ON t.id = e.excise_type_id WHERE e.company_id = ${companyId} AND e.date BETWEEN ${from} AND ${to} ORDER BY e.date, e.id`;
  const products = await sql<{ id: number; label: string }[]>`SELECT id, sku || ' ' || name AS label FROM inv_products WHERE company_id = ${companyId} AND active ORDER BY sku`;
  const computed = computeReturn(await basis(sql, companyId, period));
  const returns = await sql<{ id: number; period: string; total: number; lines: { name: string; quantity: number; unit: string; tax: number }[]; voucher_id: number | null; paid_on: string | null }[]>`
    SELECT id, period, total::float8 AS total, lines, voucher_id, to_char(paid_on,'YYYY-MM-DD') AS paid_on FROM excise_returns WHERE company_id = ${companyId} ORDER BY period DESC LIMIT 36`;
  const [{ ledger }] = await sql<{ ledger: number }[]>`SELECT COALESCE(SUM(l.credit - l.debit), 0)::float8 AS ledger FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id WHERE v.company_id = ${companyId} AND l.account_number = ${LIABILITY}`;
  return { types, links, entries, products, computed, returns: returns.map((r) => ({ ...r, due: dueDate(r.period) })), declared: returns.find((r) => r.period === period) ?? null, ledger };
}

export async function addType(actor: Actor, input: Record<string, unknown>) {
  const rate = parseRate(str(input, 'rate', { required: true, label: 'Skattesats' }));
  if (rate == null) throw new ValidationError('Ange skattesatsen i kronor per enhet');
  const account = Number(str(input, 'cost_account') || 6900);
  if (!Number.isInteger(account) || account < 4000 || account > 7999) throw new ValidationError('Kostnadskontot ska vara ett konto i klass 4–7');
  const [acc] = await sql`SELECT 1 FROM accounts WHERE company_id = ${actor.companyId} AND number = ${account} AND active`;
  if (!acc) throw new ValidationError(`Konto ${account} finns inte i kontoplanen`);
  try {
    const [t] = await sql<{ id: number }[]>`INSERT INTO excise_types ${sql({ company_id: actor.companyId, name: str(input, 'name', { required: true, label: 'Skatteslag', max: 100 }), unit: str(input, 'unit', { max: 20 }) || 'kg', rate, cost_account: account, invoice_line: input.invoice_line === 'on' || input.invoice_line === true })} RETURNING id`;
    await auditBy(sql, actor, 'excise_type', 'excise_type', t.id, { rate });
    return t.id;
  } catch (e) { if (String((e as Error).message).includes('excise_types_company_id_name_key')) throw new ConflictError('Skatteslaget finns redan'); throw e; }
}

const ownType = async (db: Db, actor: Actor, id: number) => {
  const [t] = await db`SELECT 1 FROM excise_types WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!t) throw new NotFoundError('Skatteslaget');
};

/** Lagerartikel som innehåller skattepliktig vara: faktor = skattepliktiga enheter per artikelenhet (t.ex. 0,5 kg per st) */
export async function linkProduct(actor: Actor, input: Record<string, unknown>) {
  const typeId = int(input, 'excise_type_id', 'Skatteslag'), productId = int(input, 'product_id', 'Artikel');
  const factor = qtyOf(input.factor, 'faktorn (skattepliktiga enheter per artikelenhet)');
  if (factor < 0) throw new ValidationError('Faktorn ska vara positiv');
  await ownType(sql, actor, typeId);
  const [p] = await sql`SELECT 1 FROM inv_products WHERE id = ${productId} AND company_id = ${actor.companyId}`;
  if (!p) throw new NotFoundError('Artikeln');
  await sql`INSERT INTO excise_products (excise_type_id, product_id, factor) VALUES (${typeId}, ${productId}, ${factor}) ON CONFLICT (excise_type_id, product_id) DO UPDATE SET factor = EXCLUDED.factor`;
  await auditBy(sql, actor, 'excise_link', 'excise_type', typeId, { product: productId, factor });
}

/** Eget uttag eller annan skattepliktig händelse utanför lagret (t.ex. förbrukad el i kWh); negativt för avdrag */
export async function addEntry(actor: Actor, input: Record<string, unknown>) {
  const typeId = int(input, 'excise_type_id', 'Skatteslag');
  await ownType(sql, actor, typeId);
  const d = date(input, 'date', 'Datum');
  const [done] = await sql`SELECT 1 FROM excise_returns WHERE company_id = ${actor.companyId} AND period = ${d.slice(0, 7)}`;
  if (done) throw new ConflictError('Perioden är redan deklarerad');
  await sql`INSERT INTO excise_entries ${sql({ company_id: actor.companyId, excise_type_id: typeId, date: d, quantity: qtyOf(input.quantity, 'antal enheter'), note: str(input, 'note', { max: 300 }), created_by: actor.userId })}`;
}

/** Månadens deklaration: skatten bokförs som kostnad mot skulden på 2660 */
export async function declare(actor: Actor, period: string) {
  if (!PERIOD.test(period)) throw new ValidationError('Ogiltig period');
  return sql.begin(async (tx) => {
    await tx`SELECT id FROM companies WHERE id = ${actor.companyId} FOR UPDATE`;
    const [done] = await tx`SELECT 1 FROM excise_returns WHERE company_id = ${actor.companyId} AND period = ${period}`;
    if (done) throw new ConflictError('Perioden är redan deklarerad');
    const r = computeReturn(await basis(tx, actor.companyId, period));
    if (!r.lines.length) throw new ValidationError('Det finns inget skattepliktigt underlag för perioden');
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${LIABILITY}, 'Särskilda punktskatter') ON CONFLICT DO NOTHING`;
    let voucherId: number | null = null;
    if (r.total) {
      const [, to] = bounds(period);
      voucherId = (await createVoucher(tx, { actor, date: to, description: `Punktskatt ${period}: ${r.lines.map((l) => l.name).join(', ')}`, lines: fromSigned(bookingLines(r.lines)), sourceType: 'excise' })).id;
    }
    const [row] = await tx<{ id: number }[]>`INSERT INTO excise_returns ${tx({ company_id: actor.companyId, period, lines: tx.json(r.lines), total: r.total, voucher_id: voucherId, created_by: actor.userId })} RETURNING id`;
    await auditBy(tx, actor, 'excise_declared', 'excise_return', row.id, { period, total: r.total });
    return r;
  });
}

/** Betalningen till skattekontot */
export async function pay(actor: Actor, id: number, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum');
  return sql.begin(async (tx) => {
    const [r] = await tx<{ period: string; total: number; paid_on: string | null }[]>`SELECT period, total::float8 AS total, paid_on FROM excise_returns WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!r) throw new NotFoundError('Deklarationen');
    if (r.paid_on) throw new ConflictError('Punktskatten är redan betald');
    if (!r.total) throw new ConflictError('Det finns inget att betala');
    const v = await createVoucher(tx, { actor, date: d, description: `Punktskatt ${r.period} till skattekontot`, lines: fromSigned(paymentLines(r.total)), sourceType: 'excise' });
    await tx`UPDATE excise_returns SET paid_on = ${d}, paid_voucher_id = ${v.id} WHERE id = ${id}`;
    return r.total;
  });
}

/** Fakturarader som visar punktskatten för levererade artiklar (ingår i priset och i momsunderlaget) */
export async function invoiceLinesFor(db: Db, companyId: number, items: { product_id: number; qty: number; vat_rate: number }[]) {
  if (!items.length) return [];
  const links = await db<{ product_id: number; name: string; unit: string; rate: number; factor: number }[]>`SELECT ep.product_id, t.name, t.unit, t.rate::float8 AS rate, ep.factor::float8 AS factor
    FROM excise_products ep JOIN excise_types t ON t.id = ep.excise_type_id WHERE t.company_id = ${companyId} AND t.active AND t.invoice_line AND ep.product_id IN ${db(items.map((i) => i.product_id))}`;
  return links.map((l) => {
    const it = items.find((i) => i.product_id === l.product_id)!;
    const units = Math.round(it.qty * l.factor * 1000) / 1000;
    return { description: `${l.name} ${String(units).replace('.', ',')} ${l.unit}`, quantity: 1, unit: 'st', unit_price: Math.round(units * l.rate), vat_rate: it.vat_rate };
  }).filter((l) => l.unit_price > 0);
}
