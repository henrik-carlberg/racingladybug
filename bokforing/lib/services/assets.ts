import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { ACC } from '@/lib/bas';
import { ASSET_CATEGORIES, DISPOSAL_ACCOUNTS, accumulated, duePeriods, lastDay, periodOf, type AssetCategory } from '@/lib/assets';
import type { Actor } from './actor';
import { dimId } from './dimensions';
import { date, int, optInt, str } from './input';

export interface AssetOut {
  id: number; name: string; category: AssetCategory; asset_account: number; acc_dep_account: number; dep_account: number;
  acquired_on: string; cost: number; residual: number; life_months: number; dep_start: string; status: 'active' | 'disposed'; disposed_on: string | null;
  booked: number; last_period: string | null; cost_center_id: number | null; notes: string; source_voucher_id: number | null;
}

async function ensureAccounts(db: Tx | typeof sql, companyId: number, cat: AssetCategory) {
  const c = ASSET_CATEGORIES[cat];
  const rows = [[c.asset, c.names[0]], [c.accDep, c.names[1]], [c.dep, c.names[2]], [DISPOSAL_ACCOUNTS.gain, 'Vinst vid avyttring av maskiner och inventarier'], [DISPOSAL_ACCOUNTS.loss, 'Förlust vid avyttring av maskiner och inventarier']] as const;
  for (const [n, name] of rows) await db`INSERT INTO accounts (company_id, number, name) VALUES (${companyId}, ${n}, ${name}) ON CONFLICT DO NOTHING`;
}

export async function listAssets(companyId: number, status?: 'active' | 'disposed'): Promise<AssetOut[]> {
  return [...await sql<AssetOut[]>`
    SELECT a.id, a.name, a.category, a.asset_account, a.acc_dep_account, a.dep_account, to_char(a.acquired_on,'YYYY-MM-DD') AS acquired_on, a.cost, a.residual,
      a.life_months, to_char(a.dep_start,'YYYY-MM-DD') AS dep_start, a.status, to_char(a.disposed_on,'YYYY-MM-DD') AS disposed_on, a.cost_center_id, a.notes, a.source_voucher_id,
      COALESCE((SELECT SUM(d.amount) FROM asset_depreciations d WHERE d.asset_id = a.id), 0)::bigint AS booked,
      (SELECT max(d.period) FROM asset_depreciations d WHERE d.asset_id = a.id) AS last_period
    FROM assets a WHERE a.company_id = ${companyId} ${status ? sql`AND a.status = ${status}` : sql``} ORDER BY a.acquired_on, a.id`];
}

/** Lägger upp en tillgång. Anskaffningen bokförs normalt via leverantörsfakturan (konto 12xx); här registreras planen. */
export async function createAsset(actor: Actor, input: Record<string, unknown>) {
  const category = str(input, 'category') as AssetCategory;
  const cat = ASSET_CATEGORIES[category];
  if (!cat) throw new ValidationError('Välj kategori');
  const acquired = date(input, 'acquired_on', 'Anskaffningsdatum');
  const cost = int(input, 'cost', 'Anskaffningsvärde');
  if (cost <= 0) throw new ValidationError('Anskaffningsvärdet måste vara större än noll');
  const residual = optInt(input, 'residual', 'Restvärde') ?? 0;
  if (residual < 0 || residual >= cost) throw new ValidationError('Restvärdet måste vara mindre än anskaffningsvärdet');
  const life = optInt(input, 'life_months', 'Avskrivningstid') ?? cat.life;
  if (life < 1 || life > 1200) throw new ValidationError('Avskrivningstiden ska vara 1–1200 månader');
  const depStart = date(input, 'dep_start', 'Avskrivning från', false) || `${periodOf(acquired)}-01`;
  await ensureAccounts(sql, actor.companyId, category);
  const [r] = await sql<{ id: number }[]>`INSERT INTO assets ${sql({
    company_id: actor.companyId, name: str(input, 'name', { required: true, label: 'Benämning' }), category, asset_account: cat.asset, acc_dep_account: cat.accDep, dep_account: cat.dep,
    acquired_on: acquired, cost, residual, life_months: life, dep_start: `${periodOf(depStart)}-01`, cost_center_id: dimId(input.cost_center_id),
    source_voucher_id: dimId(input.source_voucher_id), notes: str(input, 'notes'), created_by: actor.userId,
  })} RETURNING id`;
  await auditBy(sql, actor, 'create', 'asset', r.id);
  return r.id;
}

/** Bokför avskrivningar till och med en månad: en verifikation per månad, rader per tillgångskategori */
export async function runDepreciation(actor: Actor, upToPeriod: string) {
  if (!/^\d{4}-\d{2}$/.test(upToPeriod)) throw new ValidationError('Ange månad som ÅÅÅÅ-MM');
  return sql.begin(async (tx) => {
    const assets = await tx<{ id: number; name: string; cost: number; residual: number; life_months: number; dep_start: string; dep_account: number; acc_dep_account: number; cost_center_id: number | null }[]>`
      SELECT id, name, cost, residual, life_months, to_char(dep_start,'YYYY-MM-DD') AS dep_start, dep_account, acc_dep_account, cost_center_id
      FROM assets WHERE company_id = ${actor.companyId} AND status = 'active' FOR UPDATE`;
    const byPeriod = new Map<string, { assetId: number; amount: number; dep: number; accDep: number; cc: number | null }[]>();
    for (const a of assets) {
      const booked = new Set((await tx<{ period: string }[]>`SELECT period FROM asset_depreciations WHERE asset_id = ${a.id}`).map((x) => x.period));
      for (const d of duePeriods({ cost: Number(a.cost), residual: Number(a.residual), lifeMonths: a.life_months, depStart: a.dep_start }, upToPeriod, booked)) {
        (byPeriod.get(d.period) ?? byPeriod.set(d.period, []).get(d.period)!).push({ assetId: a.id, amount: d.amount, dep: a.dep_account, accDep: a.acc_dep_account, cc: a.cost_center_id });
      }
    }
    let vouchers = 0, total = 0;
    for (const period of [...byPeriod.keys()].sort()) {
      const items = byPeriod.get(period)!;
      const v = await createVoucher(tx, {
        actor, date: lastDay(period), description: `Avskrivningar enligt plan ${period}`, sourceType: 'depreciation',
        lines: fromSigned(items.flatMap((i) => [{ account: i.dep, amount: i.amount, costCenterId: i.cc }, { account: i.accDep, amount: -i.amount }])),
      });
      for (const i of items) await tx`INSERT INTO asset_depreciations (asset_id, period, amount, voucher_id) VALUES (${i.assetId}, ${period}, ${i.amount}, ${v.id})`;
      vouchers++; total += items.reduce((s, i) => s + i.amount, 0);
    }
    await auditBy(tx, actor, 'depreciate', 'company', actor.companyId, { upTo: upToPeriod, vouchers, total });
    return { vouchers, total };
  });
}

/**
 * Avyttring (försäljning eller utrangering): anskaffningsvärdet och ackumulerade avskrivningar bokas bort,
 * försäljningspriset (exkl. moms) mot bank och utgående moms, mellanskillnaden som vinst (3973) eller förlust (7973).
 */
export async function disposeAsset(actor: Actor, id: number, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum');
  const price = optInt(input, 'price', 'Försäljningspris') ?? 0;
  const vatRate = optInt(input, 'vat_rate', 'Moms') ?? 25;
  const bank = optInt(input, 'bank_account', 'Bankkonto') ?? ACC.bank;
  if (![0, 25].includes(vatRate)) throw new ValidationError('Moms 0 eller 25 %');
  return sql.begin(async (tx) => {
    const [a] = await tx<{ name: string; cost: number; asset_account: number; acc_dep_account: number; status: string; category: AssetCategory }[]>`
      SELECT name, cost, asset_account, acc_dep_account, status, category FROM assets WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!a) throw new NotFoundError('Tillgången');
    if (a.status !== 'active') throw new ConflictError('Tillgången är redan avyttrad');
    await ensureAccounts(tx, actor.companyId, a.category);
    const [{ booked }] = await tx<{ booked: number }[]>`SELECT COALESCE(SUM(amount), 0)::bigint AS booked FROM asset_depreciations WHERE asset_id = ${id}`;
    const book = Number(a.cost) - Number(booked);
    const vat = Math.round((price * vatRate) / 100);
    const result = price - book; // positivt = vinst
    const v = await createVoucher(tx, {
      actor, date: d, description: `${price ? 'Försäljning' : 'Utrangering'} av ${a.name}`, sourceType: 'asset_disposal', sourceId: id,
      lines: fromSigned([
        { account: a.asset_account, amount: -Number(a.cost) },
        { account: a.acc_dep_account, amount: Number(booked) },
        ...(price ? [{ account: bank, amount: price + vat }] : []),
        ...(vat ? [{ account: ACC.vatOut[25], amount: -vat }] : []),
        ...(result > 0 ? [{ account: DISPOSAL_ACCOUNTS.gain, amount: -result }] : result < 0 ? [{ account: DISPOSAL_ACCOUNTS.loss, amount: -result }] : []),
      ]),
    });
    await tx`UPDATE assets SET status = 'disposed', disposed_on = ${d}, disposal_voucher_id = ${v.id} WHERE id = ${id}`;
    await auditBy(tx, actor, 'dispose', 'asset', id, { price, book });
    return { voucherId: v.id, book, result };
  });
}

export async function deleteAsset(actor: Actor, id: number) {
  const [n] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM asset_depreciations WHERE asset_id = ${id}`;
  if (n.n) throw new ConflictError('Tillgången har bokförda avskrivningar och kan inte tas bort. Avyttra den i stället.');
  const r = await sql`DELETE FROM assets WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!r.count) throw new NotFoundError('Tillgången');
}

/** Bokförda anskaffningar på anläggningskonton som inte finns i registret (förslag att lägga upp) */
export async function unregisteredAcquisitions(companyId: number) {
  return sql<{ voucher_id: number; label: string; date: string; account: number; amount: number; description: string }[]>`
    SELECT v.id AS voucher_id, v.series || v.number AS label, to_char(v.date,'YYYY-MM-DD') AS date, l.account_number AS account, l.debit AS amount,
      COALESCE(NULLIF(l.description, ''), v.description) AS description
    FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${companyId} AND l.debit > 0 AND l.account_number IN (1010, 1110, 1210, 1220, 1240, 1250) AND v.date > now() - interval '2 years'
      AND v.source_type IS DISTINCT FROM 'opening_balance' AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.source_voucher_id = v.id)
      AND NOT EXISTS (SELECT 1 FROM vouchers r WHERE r.corrects_id = v.id)
    ORDER BY v.date DESC LIMIT 50`;
}

/** Bokfört värde: anskaffningsvärde minus bokförda avskrivningar */
export const bookValue = (a: AssetOut) => Number(a.cost) - Number(a.booked);
/** Avskrivning enligt plan till och med en månad (för att se vad som återstår att bokföra) */
export const planned = (a: AssetOut, upTo: string) => accumulated({ cost: Number(a.cost), residual: Number(a.residual), lifeMonths: a.life_months, depStart: a.dep_start }, upTo);
