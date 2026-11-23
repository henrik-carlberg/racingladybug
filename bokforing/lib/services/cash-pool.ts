import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { INTEREST_COST, INTEREST_INCOME, MASTER_DEBT, MEMBER_CLAIM, interestLines, monthBounds, monthlyInterest, sweepLines } from '@/lib/cash-pool';
import type { Actor } from './actor';
import { date, int, optInt, str } from './input';

const NAMES: Record<number, string> = { [MEMBER_CLAIM]: 'Kortfristiga fordringar hos koncernföretag', [MASTER_DEBT]: 'Kortfristiga skulder till koncernföretag', [INTEREST_INCOME]: 'Ränteintäkter från omsättningstillgångar', [INTEREST_COST]: 'Räntekostnader för kortfristiga skulder' };
const ensure = async (tx: Tx, companyId: number, ns: number[]) => { for (const n of ns) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${companyId}, ${n}, ${NAMES[n]}) ON CONFLICT DO NOTHING`; };
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const rate = (v: unknown, label: string) => { const n = Number(String(v ?? '').trim().replace(',', '.') || '0'); if (!Number.isFinite(n) || n < 0 || n >= 50) throw new ValidationError(`Ange ${label} i procent`); return Math.round(n * 1000) / 1000; };

/** Användaren måste få bokföra i dotterbolaget – verifikationerna skapas där i användarens namn */
async function memberActor(db: Tx | typeof sql, actor: Actor, companyId: number): Promise<Actor> {
  const [m] = await db<{ role: Actor['role'] }[]>`SELECT role FROM memberships WHERE company_id = ${companyId} AND user_id = ${actor.userId}
    AND (role = 'owner' OR (role = 'accountant' AND (permissions IS NULL OR 'ledger' = ANY(permissions))))`;
  if (!m) throw new ForbiddenError('Du behöver behörighet till bokföringen i dotterbolaget');
  return { companyId, userId: actor.userId, apiKeyId: null, role: m.role };
}

async function pool(db: Tx | typeof sql, companyId: number, id: number) {
  const [p] = await db<{ id: number; name: string; bank_account: number; deposit_rate: number; borrow_rate: number }[]>`SELECT id, name, bank_account, deposit_rate::float8 AS deposit_rate, borrow_rate::float8 AS borrow_rate
    FROM cash_pools WHERE id = ${id} AND company_id = ${companyId}`;
  if (!p) throw new NotFoundError('Koncernkontot');
  return p;
}

const ledgerSum = async (companyId: number, account: number, sourceId?: number) => {
  const [{ s }] = await sql<{ s: number }[]>`SELECT COALESCE(SUM(l.debit - l.credit), 0)::float8 AS s FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${companyId} AND l.account_number = ${account} AND v.source_type = 'cash_pool' ${sourceId ? sql`AND v.source_id = ${sourceId}` : sql``}`;
  return s;
};

export async function overview(companyId: number, period: string) {
  const pools = await sql<{ id: number; name: string; bank_account: number; deposit_rate: number; borrow_rate: number }[]>`SELECT id, name, bank_account, deposit_rate::float8 AS deposit_rate, borrow_rate::float8 AS borrow_rate
    FROM cash_pools WHERE company_id = ${companyId} ORDER BY name`;
  const out = [];
  for (const p of pools) {
    const members = await sql<{ company_id: number; name: string; bank_account: number }[]>`SELECT m.company_id, c.name, m.bank_account FROM cash_pool_members m JOIN companies c ON c.id = m.company_id WHERE m.pool_id = ${p.id} ORDER BY c.name`;
    const rows = [];
    for (const m of members) {
      const transfers = await sql<{ date: string; amount: number; kind: string; period: string | null }[]>`SELECT to_char(date,'YYYY-MM-DD') AS date, amount::float8 AS amount, kind, period FROM cash_pool_transfers
        WHERE pool_id = ${p.id} AND company_id = ${m.company_id} ORDER BY date, id`;
      const balance = transfers.reduce((s, t) => s + t.amount, 0);
      const calc = PERIOD.test(period) ? monthlyInterest(transfers, period, p.deposit_rate, p.borrow_rate) : null;
      const booked = transfers.find((t) => t.kind === 'interest' && t.period === period);
      const memberLedger = await ledgerSum(m.company_id, MEMBER_CLAIM, p.id);
      const masterLedger = -(await ledgerSum(companyId, MASTER_DEBT, m.company_id));
      rows.push({ ...m, balance, calc, interestBooked: booked ? booked.amount : null, memberLedger, masterLedger, diff: memberLedger - masterLedger, recent: transfers.slice(-8).reverse() });
    }
    out.push({ ...p, members: rows, total: rows.reduce((s, r) => s + r.balance, 0) });
  }
  const subsidiaries = await sql<{ id: number; name: string }[]>`SELECT c.id, c.name FROM group_links g JOIN companies c ON c.id = g.subsidiary_company_id WHERE g.parent_company_id = ${companyId} ORDER BY c.name`;
  const memberOf = await sql<{ pool: string; master: string; balance: number }[]>`SELECT p.name AS pool, c.name AS master, COALESCE((SELECT SUM(t.amount) FROM cash_pool_transfers t WHERE t.pool_id = p.id AND t.company_id = ${companyId}), 0)::float8 AS balance
    FROM cash_pool_members m JOIN cash_pools p ON p.id = m.pool_id JOIN companies c ON c.id = p.company_id WHERE m.company_id = ${companyId}`;
  return { pools: out, subsidiaries, memberOf };
}

export async function createPool(actor: Actor, input: Record<string, unknown>) {
  const bank = optInt(input, 'bank_account', 'Bankkonto') ?? 1930;
  if (bank < 1900 || bank > 1999) throw new ValidationError('Huvudkontot ska vara ett bankkonto (19xx)');
  try {
    const [p] = await sql<{ id: number }[]>`INSERT INTO cash_pools ${sql({ company_id: actor.companyId, name: str(input, 'name', { required: true, label: 'Namn', max: 100 }), bank_account: bank,
      deposit_rate: rate(input.deposit_rate, 'insättningsräntan'), borrow_rate: rate(input.borrow_rate, 'utlåningsräntan'), created_by: actor.userId })} RETURNING id`;
    await auditBy(sql, actor, 'cash_pool', 'cash_pool', p.id);
    return p.id;
  } catch (e) { if (String((e as Error).message).includes('cash_pools_company_id_name_key')) throw new ConflictError('Det finns redan ett koncernkonto med det namnet'); throw e; }
}

/** Dotterbolag ansluts med sitt bankkonto (underkontot); bolaget ska vara dotterbolag i koncernstrukturen */
export async function addMember(actor: Actor, poolId: number, input: Record<string, unknown>) {
  await pool(sql, actor.companyId, poolId);
  const companyId = int(input, 'company_id', 'Dotterbolag');
  const [g] = await sql`SELECT 1 FROM group_links WHERE parent_company_id = ${actor.companyId} AND subsidiary_company_id = ${companyId}`;
  if (!g) throw new ValidationError('Bolaget är inte ett dotterbolag i koncernstrukturen');
  await memberActor(sql, actor, companyId);
  const bank = optInt(input, 'bank_account', 'Bankkonto') ?? 1930;
  if (bank < 1900 || bank > 1999) throw new ValidationError('Underkontot ska vara ett bankkonto (19xx)');
  await sql`INSERT INTO cash_pool_members (pool_id, company_id, bank_account) VALUES (${poolId}, ${companyId}, ${bank}) ON CONFLICT (pool_id, company_id) DO UPDATE SET bank_account = EXCLUDED.bank_account`;
  await auditBy(sql, actor, 'cash_pool_member', 'cash_pool', poolId, { company: companyId });
}

const member = async (tx: Tx, poolId: number, companyId: number) => {
  const [m] = await tx<{ bank_account: number }[]>`SELECT bank_account FROM cash_pool_members WHERE pool_id = ${poolId} AND company_id = ${companyId}`;
  if (!m) throw new NotFoundError('Dotterbolaget i koncernkontot');
  return m;
};

/** Överföring mellan underkontot och huvudkontot (t.ex. daglig nollställning): bokförs i båda bolagen */
export async function sweep(actor: Actor, poolId: number, input: Record<string, unknown>) {
  const companyId = int(input, 'company_id', 'Dotterbolag');
  const d = date(input, 'date', 'Datum');
  const raw = String(input.amount ?? '').trim();
  const neg = raw.startsWith('-') || input.direction === 'out';
  const abs = parseAmount(raw.replace(/^-/, ''));
  if (abs == null || abs <= 0) throw new ValidationError('Ange beloppet i kronor');
  const amount = neg ? -abs : abs;
  return sql.begin(async (tx) => {
    const p = await pool(tx, actor.companyId, poolId);
    await tx`SELECT id FROM cash_pools WHERE id = ${poolId} FOR UPDATE`;
    const m = await member(tx, poolId, companyId);
    const ma = await memberActor(tx, actor, companyId);
    const [{ name }] = await tx<{ name: string }[]>`SELECT name FROM companies WHERE id = ${companyId}`;
    await ensure(tx, companyId, [MEMBER_CLAIM]); await ensure(tx, actor.companyId, [MASTER_DEBT]);
    const desc = `${p.name}: ${amount > 0 ? 'överföring till huvudkontot' : 'överföring från huvudkontot'}`;
    const mv = await createVoucher(tx, { actor: ma, date: d, description: desc, lines: fromSigned(sweepLines(amount, 'member', m.bank_account)), sourceType: 'cash_pool', sourceId: poolId });
    const xv = await createVoucher(tx, { actor, date: d, description: `${desc} (${name})`, lines: fromSigned(sweepLines(amount, 'master', p.bank_account)), sourceType: 'cash_pool', sourceId: companyId });
    await tx`INSERT INTO cash_pool_transfers ${tx({ pool_id: poolId, company_id: companyId, date: d, kind: 'sweep', amount, member_voucher_id: mv.id, master_voucher_id: xv.id, created_by: actor.userId })}`;
    return amount;
  });
}

/** Månadens internränta på det dagliga saldot bokförs i båda bolagen och läggs till saldot */
export async function bookInterest(actor: Actor, poolId: number, period: string) {
  if (!PERIOD.test(period)) throw new ValidationError('Ogiltig period');
  return sql.begin(async (tx) => {
    const p = await pool(tx, actor.companyId, poolId);
    await tx`SELECT id FROM cash_pools WHERE id = ${poolId} FOR UPDATE`;
    const members = await tx<{ company_id: number; name: string }[]>`SELECT m.company_id, c.name FROM cash_pool_members m JOIN companies c ON c.id = m.company_id WHERE m.pool_id = ${poolId} ORDER BY c.name`;
    const { to } = monthBounds(period);
    let booked = 0, total = 0;
    for (const m of members) {
      const [done] = await tx`SELECT 1 FROM cash_pool_transfers WHERE pool_id = ${poolId} AND company_id = ${m.company_id} AND kind = 'interest' AND period = ${period}`;
      if (done) continue;
      const transfers = await tx<{ date: string; amount: number }[]>`SELECT to_char(date,'YYYY-MM-DD') AS date, amount::float8 AS amount FROM cash_pool_transfers WHERE pool_id = ${poolId} AND company_id = ${m.company_id} AND date <= ${to}`;
      const { interest } = monthlyInterest(transfers, period, p.deposit_rate, p.borrow_rate);
      if (!interest) continue;
      const ma = await memberActor(tx, actor, m.company_id);
      await ensure(tx, m.company_id, [MEMBER_CLAIM, interest > 0 ? INTEREST_INCOME : INTEREST_COST]);
      await ensure(tx, actor.companyId, [MASTER_DEBT, interest > 0 ? INTEREST_COST : INTEREST_INCOME]);
      const desc = `${p.name}: internränta ${period}`;
      const mv = await createVoucher(tx, { actor: ma, date: to, description: desc, lines: fromSigned(interestLines(interest, 'member')), sourceType: 'cash_pool', sourceId: poolId });
      const xv = await createVoucher(tx, { actor, date: to, description: `${desc} (${m.name})`, lines: fromSigned(interestLines(interest, 'master')), sourceType: 'cash_pool', sourceId: m.company_id });
      await tx`INSERT INTO cash_pool_transfers ${tx({ pool_id: poolId, company_id: m.company_id, date: to, kind: 'interest', amount: interest, period, member_voucher_id: mv.id, master_voucher_id: xv.id, created_by: actor.userId })}`;
      booked++; total += interest;
    }
    if (!booked) throw new ConflictError('Det finns ingen ränta att bokföra för perioden (redan bokförd eller noll)');
    await auditBy(tx, actor, 'cash_pool_interest', 'cash_pool', poolId, { period, booked, total });
    return { booked, total };
  });
}
