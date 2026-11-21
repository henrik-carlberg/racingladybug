import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, ForbiddenError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { ACCOUNTS, deductionRoom, depositLines, depositRoom, maxDeposit, type ForestAccount, type Sale, type SaleKind } from '@/lib/forest';
import type { Actor } from './actor';
import { date, str } from './input';
import { today } from '@/lib/format';

const kronor = (v: unknown, label: string, zero = false) => { const n = parseAmount(String(v ?? '').trim() || (zero ? '0' : '')); if (n == null || n < 0 || (!zero && !n)) throw new ValidationError(`Ange ${label} i kronor`); return n; };
const account = (v: unknown): ForestAccount => (v === 'skada' ? 'skada' : 'skog');
async function soleTrader(companyId: number) {
  const [c] = await sql<{ t: string }[]>`SELECT company_type AS t FROM companies WHERE id = ${companyId}`;
  if (c.t !== 'EF') throw new ForbiddenError('Skogskonto och skogsavdrag gäller enskild näringsverksamhet');
}

export async function overview(companyId: number, year: number) {
  const [s] = await sql<{ acquisition_value: number; used_before: number }[]>`SELECT acquisition_value::float8 AS acquisition_value, used_before::float8 AS used_before FROM forest_settings WHERE company_id = ${companyId}`;
  const settings = s ?? { acquisition_value: 0, used_before: 0 };
  const sales = await sql<(Sale & { id: number; date: string; note: string })[]>`SELECT id, to_char(date,'YYYY-MM-DD') AS date, kind, amount::float8 AS amount, note FROM forest_sales
    WHERE company_id = ${companyId} AND extract(year from date) = ${year} ORDER BY date`;
  const tx = await sql<{ id: number; tax_year: number; date: string; account: ForestAccount; kind: 'deposit' | 'withdrawal'; amount: number }[]>`SELECT id, tax_year, to_char(date,'YYYY-MM-DD') AS date, account, kind,
    amount::float8 AS amount FROM forest_transactions WHERE company_id = ${companyId} ORDER BY date DESC, id DESC`;
  const deposited = { skog: 0, skada: 0 };
  for (const t of tx) if (t.tax_year === year && t.kind === 'deposit') deposited[t.account] += t.amount;
  const balance = (a: ForestAccount) => tx.filter((t) => t.account === a).reduce((x, t) => x + (t.kind === 'deposit' ? t.amount : -t.amount), 0);
  const withdrawnThisYear = tx.filter((t) => t.kind === 'withdrawal' && t.date.startsWith(String(year))).reduce((x, t) => x + t.amount, 0);
  const deds = await sql<{ tax_year: number; amount: number }[]>`SELECT tax_year, amount::float8 AS amount FROM forest_deductions WHERE company_id = ${companyId}`;
  // Taket gäller sammanlagt för alla år: övriga års skogsavdrag (även senare år) tar utrymme
  const usedBefore = settings.used_before + deds.filter((d) => d.tax_year !== year).reduce((x, d) => x + d.amount, 0);
  const deduction = deds.find((d) => d.tax_year === year)?.amount ?? 0;
  return {
    year, settings, sales, transactions: tx, deposited, deduction, withdrawnThisYear,
    room: { skog: depositRoom(sales, 'skog', deposited), skada: depositRoom(sales, 'skada', deposited) },
    max: { skog: maxDeposit(sales, 'skog'), skada: maxDeposit(sales, 'skada') },
    balance: { skog: balance('skog'), skada: balance('skada') },
    deductionRoom: deductionRoom(sales, settings.acquisition_value, usedBefore),
  };
}

export async function saveSettings(actor: Actor, input: Record<string, unknown>) {
  await soleTrader(actor.companyId);
  const acq = kronor(input.acquisition_value, 'anskaffningsvärdet', true), used = kronor(input.used_before, 'tidigare skogsavdrag', true);
  await sql`INSERT INTO forest_settings ${sql({ company_id: actor.companyId, acquisition_value: acq, used_before: used })} ON CONFLICT (company_id) DO UPDATE SET acquisition_value = EXCLUDED.acquisition_value, used_before = EXCLUDED.used_before`;
}

export async function addSale(actor: Actor, input: Record<string, unknown>) {
  await soleTrader(actor.companyId);
  const kind = (str(input, 'kind') === 'leveransvirke' ? 'leveransvirke' : 'rotpost') as SaleKind;
  await sql`INSERT INTO forest_sales ${sql({ company_id: actor.companyId, date: date(input, 'date', 'Datum'), kind, amount: kronor(input.amount, 'likviden'), note: str(input, 'note', { max: 200 }) })}`;
}

/** Insättning på skogskonto eller skogsskadekonto för ett beskattningsår (görs senast när deklarationen lämnas) */
export async function deposit(actor: Actor, input: Record<string, unknown>) {
  await soleTrader(actor.companyId);
  const a = account(input.account), amount = kronor(input.amount, 'beloppet'), d = date(input, 'date', 'Datum');
  const year = Number(str(input, 'tax_year'));
  if (!Number.isInteger(year) || year < 2000 || Number(d.slice(0, 4)) < year || Number(d.slice(0, 4)) > year + 1) throw new ValidationError('Insättningen ska göras under beskattningsåret eller senast när deklarationen lämnas året efter');
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('forest'), ${actor.companyId})`;
    const o = await overview(actor.companyId, year);
    if (amount > o.room[a]) throw new ConflictError(`Utrymmet för insättning ${year} är ${(o.room[a] / 100).toLocaleString('sv-SE')} kr`);
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${ACCOUNTS.skog}, 'Skogskonto'), (${actor.companyId}, ${ACCOUNTS.skada}, 'Skogsskadekonto') ON CONFLICT DO NOTHING`;
    const v = await createVoucher(tx, { actor, date: d, description: `Insättning på ${a === 'skog' ? 'skogskonto' : 'skogsskadekonto'} för ${year}`, lines: fromSigned(depositLines(a, amount)), sourceType: 'forest' });
    await tx`INSERT INTO forest_transactions ${tx({ company_id: actor.companyId, tax_year: year, date: d, account: a, kind: 'deposit', amount, voucher_id: v.id, created_by: actor.userId })}`;
    await auditBy(tx, actor, 'forest_deposit', 'company', actor.companyId, { year, account: a, amount });
  });
}

/** Uttag från kontot: beskattas som intäkt det år uttaget görs */
export async function withdraw(actor: Actor, input: Record<string, unknown>) {
  await soleTrader(actor.companyId);
  const a = account(input.account), amount = kronor(input.amount, 'beloppet'), d = date(input, 'date', 'Datum');
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('forest'), ${actor.companyId})`;
    const [{ bal }] = await tx<{ bal: number }[]>`SELECT COALESCE(SUM(CASE WHEN kind = 'deposit' THEN amount ELSE -amount END), 0)::float8 AS bal FROM forest_transactions WHERE company_id = ${actor.companyId} AND account = ${a}`;
    if (amount > bal) throw new ConflictError(`Saldot är ${(bal / 100).toLocaleString('sv-SE')} kr`);
    const v = await createVoucher(tx, { actor, date: d, description: `Uttag från ${a === 'skog' ? 'skogskonto' : 'skogsskadekonto'}`, lines: fromSigned(depositLines(a, amount, true)), sourceType: 'forest' });
    await tx`INSERT INTO forest_transactions ${tx({ company_id: actor.companyId, tax_year: Number(d.slice(0, 4)), date: d, account: a, kind: 'withdrawal', amount, voucher_id: v.id, created_by: actor.userId })}`;
    await auditBy(tx, actor, 'forest_withdrawal', 'company', actor.companyId, { account: a, amount });
  });
}

/** Årets skogsavdrag (yrkas i NE-bilagan), högst utrymmet */
export async function setDeduction(actor: Actor, input: Record<string, unknown>) {
  await soleTrader(actor.companyId);
  const year = Number(str(input, 'tax_year')), amount = kronor(input.amount, 'skogsavdraget', true);
  if (!Number.isInteger(year) || year < 2000 || year > Number(today().slice(0, 4))) throw new ValidationError('Ange ett beskattningsår som har börjat');
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('forest'), ${actor.companyId})`;
    const o = await overview(actor.companyId, year);
    if (amount > o.deductionRoom.max) throw new ValidationError(`Skogsavdraget får vara högst ${(o.deductionRoom.max / 100).toLocaleString('sv-SE')} kr för ${year}`);
    await tx`INSERT INTO forest_deductions ${tx({ company_id: actor.companyId, tax_year: year, amount })} ON CONFLICT (company_id, tax_year) DO UPDATE SET amount = EXCLUDED.amount`;
  });
}
