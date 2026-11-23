import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { today } from '@/lib/format';
import { change, indexFactor, indexedPrice } from '@/lib/indexation';
import type { Actor } from './actor';
import { int, str } from './input';

type Db = Tx | typeof sql;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

async function indexValue(db: Db, companyId: number, name: string, period: string) {
  const [v] = await db<{ value: number }[]>`SELECT value::float8 AS value FROM index_values WHERE company_id = ${companyId} AND index_name = ${name} AND period = ${period}`;
  return v?.value ?? null;
}

/** Förhandsgranskning: nya priser per avtal och rad mot den valda indexmånaden */
async function proposals(db: Db, companyId: number, period: string, onlyId?: number) {
  const list = await db<{ contract_id: number; name: string; customer: string; status: string; index_name: string; base_period: string; share: number; floor: boolean; base_prices: Record<string, number>; last_period: string | null }[]>`
    SELECT x.contract_id, c.name, cu.name AS customer, c.status, x.index_name, x.base_period, x.share::float8 AS share, x.floor, x.base_prices, x.last_period
    FROM contract_indexation x JOIN avt_contracts c ON c.id = x.contract_id JOIN customers cu ON cu.id = c.customer_id
    WHERE x.company_id = ${companyId} ${onlyId ? db`AND x.contract_id = ${onlyId}` : db``} ORDER BY cu.name, c.name`;
  const out = [];
  for (const x of list) {
    const lines = await db<{ id: number; description: string; quantity: number; unit_price: number }[]>`SELECT id, description, quantity::float8 AS quantity, unit_price::float8 AS unit_price FROM avt_lines WHERE contract_id = ${x.contract_id} ORDER BY position`;
    const base = await indexValue(db, companyId, x.index_name, x.base_period), cur = await indexValue(db, companyId, x.index_name, period);
    const factor = base && cur ? indexFactor({ base, current: cur, share: x.share, floor: x.floor }) : null;
    const rows = lines.map((l) => {
      const basePrice = x.base_prices[String(l.id)] ?? l.unit_price;
      const next = factor != null ? indexedPrice(basePrice, factor) : null;
      return { ...l, basePrice, next, ...(next != null ? change(l.unit_price, next) : { diff: 0, pct: 0 }) };
    });
    const now = rows.reduce((s, r) => s + Math.round(r.unit_price * r.quantity), 0), after = rows.reduce((s, r) => s + Math.round((r.next ?? r.unit_price) * r.quantity), 0);
    out.push({ ...x, baseIndex: base, index: cur, factor, rows, total: now, newTotal: after, ...change(now, after), applied: x.last_period === period });
  }
  return out;
}

export async function overview(companyId: number, period: string) {
  if (!PERIOD.test(period)) throw new ValidationError('Ogiltig indexmånad');
  const series = await sql<{ index_name: string; period: string; value: number }[]>`SELECT index_name, period, value::float8 AS value FROM index_values WHERE company_id = ${companyId} ORDER BY index_name, period DESC`;
  const contracts = await sql<{ id: number; name: string; customer: string }[]>`SELECT c.id, c.name, cu.name AS customer FROM avt_contracts c JOIN customers cu ON cu.id = c.customer_id
    WHERE c.company_id = ${companyId} AND c.status <> 'ended' AND NOT EXISTS (SELECT 1 FROM contract_indexation x WHERE x.contract_id = c.id) ORDER BY cu.name, c.name`;
  const history = await sql<{ contract: string; description: string; date: string; old_price: number; new_price: number; index_period: string }[]>`
    SELECT c.name AS contract, l.description, to_char(h.date,'YYYY-MM-DD') AS date, h.old_price::float8 AS old_price, h.new_price::float8 AS new_price, h.index_period
    FROM contract_price_history h JOIN avt_contracts c ON c.id = h.contract_id LEFT JOIN avt_lines l ON l.id = h.line_id WHERE h.company_id = ${companyId} ORDER BY h.date DESC, h.id DESC LIMIT 50`;
  return { series, contracts, history, proposals: await proposals(sql, companyId, period) };
}

export async function addIndex(actor: Actor, input: Record<string, unknown>) {
  const name = str(input, 'index_name', { required: true, label: 'Index', max: 40 }).toUpperCase();
  const period = str(input, 'period', { required: true, label: 'Månad' });
  if (!PERIOD.test(period)) throw new ValidationError('Ange månaden som ÅÅÅÅ-MM');
  const value = Number(String(input.value ?? '').replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) throw new ValidationError('Ange indexvärdet');
  await sql`INSERT INTO index_values (company_id, index_name, period, value) VALUES (${actor.companyId}, ${name}, ${period}, ${value})
    ON CONFLICT (company_id, index_name, period) DO UPDATE SET value = EXCLUDED.value`;
}

/** Avtalet kopplas till ett index; dagens priser blir baspriser */
export async function link(actor: Actor, input: Record<string, unknown>) {
  const contractId = int(input, 'contract_id', 'Avtal');
  const [c] = await sql`SELECT 1 FROM avt_contracts WHERE id = ${contractId} AND company_id = ${actor.companyId}`;
  if (!c) throw new NotFoundError('Avtalet');
  const name = str(input, 'index_name', { required: true, label: 'Index', max: 40 }).toUpperCase();
  const base = str(input, 'base_period', { required: true, label: 'Basmånad' });
  if (!PERIOD.test(base)) throw new ValidationError('Ange basmånaden som ÅÅÅÅ-MM');
  if (await indexValue(sql, actor.companyId, name, base) == null) throw new ValidationError(`Lägg in ${name} för ${base} först`);
  const share = Number(String(input.share ?? '100').replace(',', '.') || '100');
  if (!Number.isFinite(share) || share <= 0 || share > 100) throw new ValidationError('Andelen ska vara 1–100 %');
  const lines = await sql<{ id: number; unit_price: number }[]>`SELECT id, unit_price::float8 AS unit_price FROM avt_lines WHERE contract_id = ${contractId}`;
  try {
    await sql`INSERT INTO contract_indexation ${sql({ contract_id: contractId, company_id: actor.companyId, index_name: name, base_period: base, share, floor: input.floor !== undefined ? input.floor === 'on' : true,
      base_prices: sql.json(Object.fromEntries(lines.map((l) => [String(l.id), l.unit_price]))), created_by: actor.userId })}`;
  } catch (e) { if (String((e as Error).message).includes('contract_indexation_pkey')) throw new ConflictError('Avtalet är redan kopplat till ett index'); throw e; }
}

/** Uppräkningen tillämpas: radernas priser uppdateras och historiken sparas */
export async function apply(actor: Actor, period: string, input: Record<string, unknown>) {
  if (!PERIOD.test(period)) throw new ValidationError('Ogiltig indexmånad');
  const ids = Object.keys(input).filter((k) => /^c_\d+$/.test(k) && input[k] === 'on').map((k) => Number(k.slice(2)));
  if (!ids.length) throw new ValidationError('Välj minst ett avtal');
  return sql.begin(async (tx) => {
    let contracts = 0, lines = 0;
    for (const id of ids) {
      const [lock] = await tx`SELECT 1 FROM contract_indexation WHERE contract_id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
      if (!lock) throw new NotFoundError('Avtalet');
      const [p] = await proposals(tx, actor.companyId, period, id);
      if (p.applied) continue;
      if (p.factor == null) throw new ValidationError(`${p.name}: indexvärde saknas för ${p.base_period} eller ${period}`);
      for (const r of p.rows) {
        if (r.next == null || r.next === r.unit_price) continue;
        await tx`UPDATE avt_lines SET unit_price = ${r.next} WHERE id = ${r.id} AND contract_id = ${id}`;
        await tx`INSERT INTO contract_price_history ${tx({ company_id: actor.companyId, contract_id: id, line_id: r.id, date: today(), old_price: r.unit_price, new_price: r.next, index_period: period, factor: p.factor, created_by: actor.userId })}`;
        lines++;
      }
      await tx`UPDATE contract_indexation SET last_period = ${period} WHERE contract_id = ${id}`;
      await auditBy(tx, actor, 'indexation', 'avt.contract', id, { period, factor: p.factor });
      contracts++;
    }
    if (!contracts) throw new ConflictError('Uppräkningen är redan gjord för de valda avtalen');
    return { contracts, lines };
  });
}

/** Meddelande till kunden om prisjusteringen */
export async function notice(companyId: number, contractId: number, period: string) {
  const [p] = await proposals(sql, companyId, period, contractId);
  if (!p) throw new NotFoundError('Avtalet');
  const [c] = await sql<{ name: string }[]>`SELECT name FROM companies WHERE id = ${companyId}`;
  // Efter uppräkningen visas gamla och nya priser från historiken
  const hist = await sql<{ line_id: number; old_price: number; new_price: number }[]>`SELECT line_id, old_price::float8 AS old_price, new_price::float8 AS new_price FROM contract_price_history
    WHERE company_id = ${companyId} AND contract_id = ${contractId} AND index_period = ${period}`;
  const rows = p.rows.map((r) => { const h = hist.find((x) => x.line_id === r.id); return h ? { description: r.description, quantity: r.quantity, old: h.old_price, next: h.new_price } : { description: r.description, quantity: r.quantity, old: r.unit_price, next: r.next ?? r.unit_price }; });
  return { company: c.name, customer: p.customer, name: p.name, index_name: p.index_name, base_period: p.base_period, period, factor: p.factor, rows };
}
