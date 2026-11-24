import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { parseAmount } from '@/lib/money';
import { calculate, costChange, suggestPrice } from '@/lib/product-costing';
import type { Actor } from './actor';
import { optInt, str } from './input';

type Calc = { id: number; name: string; product_id: number | null; product: string | null; product_price: number | null; batch_qty: number; labour_minutes: number; labour_rate: number; mo_pct: number; to_pct: number; affo_pct: number; price: number; target_margin: number; saved_cost: number };
type Line = { id: number; calc_id: number; component_id: number | null; component: string | null; description: string; qty: number; unit_cost: number; current_cost: number | null };

async function load(db: Tx | typeof sql, companyId: number, id?: number) {
  const calcs = await db<Calc[]>`SELECT c.id, c.name, c.product_id, p.sku || ' ' || p.name AS product, p.sales_price::float8 AS product_price, c.batch_qty::float8 AS batch_qty, c.labour_minutes::float8 AS labour_minutes, c.labour_rate::float8 AS labour_rate,
      c.mo_pct::float8 AS mo_pct, c.to_pct::float8 AS to_pct, c.affo_pct::float8 AS affo_pct, c.price::float8 AS price, c.target_margin::float8 AS target_margin, c.saved_cost::float8 AS saved_cost
    FROM cost_calcs c LEFT JOIN inv_products p ON p.id = c.product_id AND p.company_id = c.company_id WHERE c.company_id = ${companyId} ${id ? db`AND c.id = ${id}` : db``} ORDER BY c.name`;
  const lines = calcs.length ? await db<Line[]>`SELECT l.id, l.calc_id, l.component_id, p.sku || ' ' || p.name AS component, l.description, l.qty::float8 AS qty, l.unit_cost::float8 AS unit_cost,
      CASE WHEN p.id IS NOT NULL AND p.purchase_price > 0 THEN p.purchase_price ELSE NULL END::float8 AS current_cost
    FROM cost_calc_lines l LEFT JOIN inv_products p ON p.id = l.component_id AND p.company_id = l.company_id WHERE l.company_id = ${companyId} AND l.calc_id IN ${db(calcs.map((c) => c.id))} ORDER BY l.id` : [];
  return calcs.map((c) => {
    const own = lines.filter((l) => l.calc_id === c.id).map((l) => ({ ...l, cost: l.current_cost ?? l.unit_cost }));
    const price = c.product_id && c.product_price != null ? c.product_price : c.price;
    const r = calculate({ materials: own.map((l) => ({ qty: l.qty, unitCost: l.cost })), batchQty: c.batch_qty, labourMinutes: c.labour_minutes, labourRate: c.labour_rate, mo: c.mo_pct, to: c.to_pct, affo: c.affo_pct }, price);
    const below = r.margin == null || r.margin < c.target_margin;
    return { ...c, lines: own, price, ...r, change: costChange(c.saved_cost, r.selfCost), below, suggested: below ? suggestPrice(r.selfCost, c.target_margin) : null };
  });
}

export async function overview(companyId: number) {
  const products = await sql<{ id: number; label: string; purchase_price: number; sales_price: number }[]>`SELECT id, sku || ' ' || name AS label, purchase_price::float8 AS purchase_price, sales_price::float8 AS sales_price FROM inv_products WHERE company_id = ${companyId} AND active ORDER BY sku LIMIT 1000`;
  return { calcs: await load(sql, companyId), products };
}

const pct = (input: Record<string, unknown>, k: string, label: string) => {
  const v = Number(String(input[k] ?? '').replace(',', '.') || '0');
  if (!Number.isFinite(v) || v < 0 || v > 500) throw new ValidationError(`${label} ska vara 0–500 %`);
  return v;
};
const num = (input: Record<string, unknown>, k: string, label: string, def = 0) => {
  const s = String(input[k] ?? '').trim().replace(',', '.');
  const v = s ? Number(s) : def;
  if (!Number.isFinite(v) || v < 0 || v > 1e9) throw new ValidationError(`Ogiltigt värde: ${label}`);
  return v;
};

export async function create(actor: Actor, input: Record<string, unknown>) {
  const productId = optInt(input, 'product_id');
  const own = async (pid: number) => { const [p] = await sql`SELECT 1 FROM inv_products WHERE id = ${pid} AND company_id = ${actor.companyId}`; if (!p) throw new NotFoundError('Artikeln'); };
  if (productId) await own(productId);
  const batch = num(input, 'batch_qty', 'Antal per sats', 1);
  if (batch <= 0) throw new ValidationError('Antal per sats ska vara större än noll');
  const rate = String(input.labour_rate ?? '').trim() ? parseAmount(String(input.labour_rate)) : 0;
  const price = String(input.price ?? '').trim() ? parseAmount(String(input.price)) : 0;
  if (rate == null || rate < 0 || price == null || price < 0) throw new ValidationError('Ogiltigt belopp');
  const target = pct(input, 'target_margin', 'Målmarginalen');
  if (target >= 100) throw new ValidationError('Målmarginalen ska vara under 100 %');
  const lines: { component_id: number | null; description: string; qty: number; unit_cost: number }[] = [];
  for (let i = 0; i < 8; i++) {
    const qty = num(input, `qty_${i}`, `Antal rad ${i + 1}`);
    if (!qty) continue;
    const comp = optInt(input, `component_${i}`);
    if (comp) await own(comp);
    const cost = String(input[`cost_${i}`] ?? '').trim() ? parseAmount(String(input[`cost_${i}`])) : 0;
    if (cost == null || cost < 0) throw new ValidationError(`Ogiltig kostnad på rad ${i + 1}`);
    if (!comp && !cost) throw new ValidationError(`Rad ${i + 1}: välj artikel eller ange kostnad`);
    lines.push({ component_id: comp ?? null, description: str(input, `desc_${i}`, { max: 150 }), qty, unit_cost: cost });
  }
  return sql.begin(async (tx) => {
    const [c] = await tx<{ id: number }[]>`INSERT INTO cost_calcs ${tx({ company_id: actor.companyId, name: str(input, 'name', { required: true, label: 'Kalkyl', max: 150 }), product_id: productId ?? null, batch_qty: batch,
      labour_minutes: num(input, 'labour_minutes', 'Arbetstid'), labour_rate: rate, mo_pct: pct(input, 'mo_pct', 'MO'), to_pct: pct(input, 'to_pct', 'TO'), affo_pct: pct(input, 'affo_pct', 'AFFO'), price, target_margin: target, created_by: actor.userId })} RETURNING id`;
    for (const l of lines) await tx`INSERT INTO cost_calc_lines ${tx({ calc_id: c.id, company_id: actor.companyId, ...l })}`;
    const [calc] = await load(tx, actor.companyId, c.id);
    await tx`UPDATE cost_calcs SET saved_cost = ${calc.selfCost} WHERE id = ${c.id}`;
    await auditBy(tx, actor, 'cost_calc', 'cost_calc', c.id, { selfCost: calc.selfCost });
    return calc;
  });
}

/** Föreslaget pris används: artikelns försäljningspris (eller kalkylens pris) uppdateras och kalkylen sparas om */
export async function applyPrice(actor: Actor, id: number) {
  return sql.begin(async (tx) => {
    const [c] = await load(tx, actor.companyId, id);
    if (!c) throw new NotFoundError('Kalkylen');
    const p = suggestPrice(c.selfCost, c.target_margin);
    if (!p) throw new ValidationError('Det går inte att räkna fram ett pris');
    if (c.product_id) await tx`UPDATE inv_products SET sales_price = ${p} WHERE id = ${c.product_id} AND company_id = ${actor.companyId}`;
    else await tx`UPDATE cost_calcs SET price = ${p} WHERE id = ${id}`;
    await tx`UPDATE cost_calcs SET saved_cost = ${c.selfCost} WHERE id = ${id}`;
    await auditBy(tx, actor, 'cost_calc_price', 'cost_calc', id, { price: p });
    return p;
  });
}

/** Kostnadsändringen är granskad: kalkylen sparas om med dagens kostnader */
export async function acknowledge(actor: Actor, id: number) {
  const [c] = await load(sql, actor.companyId, id);
  if (!c) throw new NotFoundError('Kalkylen');
  await sql`UPDATE cost_calcs SET saved_cost = ${c.selfCost} WHERE id = ${id} AND company_id = ${actor.companyId}`;
}
