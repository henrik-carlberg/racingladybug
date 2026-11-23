import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { DEPOSIT_LIABILITY, FORFEIT_INCOME, balances, forfeitLines, signedQty } from '@/lib/packaging';
import type { Actor } from './actor';
import { date, int, str } from './input';
import { saveDraftTx } from './invoices';

type Db = Tx | typeof sql;
const qty = (v: unknown) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new ValidationError('Ange antal hela förpackningar'); return n; };

async function balance(db: Db, companyId: number, customerId: number, typeId: number) {
  const [{ q }] = await db<{ q: number }[]>`SELECT COALESCE(SUM(CASE WHEN kind = 'out' THEN quantity ELSE -quantity END), 0)::int AS q FROM packaging_movements
    WHERE company_id = ${companyId} AND customer_id = ${customerId} AND type_id = ${typeId}`;
  return q;
}

export async function overview(companyId: number) {
  const types = await sql<{ id: number; name: string; deposit: number }[]>`SELECT id, name, deposit::float8 AS deposit FROM packaging_types WHERE company_id = ${companyId} AND active ORDER BY name`;
  const moves = await sql<{ customer_id: number; type_id: number; customer: string; type: string; kind: 'out' | 'return' | 'forfeit'; quantity: number; deposit: number; date: string }[]>`
    SELECT m.customer_id, m.type_id, c.name AS customer, t.name AS type, m.kind, m.quantity, m.deposit::float8 AS deposit, to_char(m.date,'YYYY-MM-DD') AS date
    FROM packaging_movements m JOIN customers c ON c.id = m.customer_id JOIN packaging_types t ON t.id = m.type_id WHERE m.company_id = ${companyId}`;
  const ids = new Map(moves.map((m) => [`${m.customer}\u0000${m.type}`, { customer_id: m.customer_id, type_id: m.type_id }]));
  const rows = balances(moves, today()).map((b) => ({ ...b, ...ids.get(`${b.customer}\u0000${b.type}`)! })).sort((a, b) => a.customer.localeCompare(b.customer, 'sv') || a.type.localeCompare(b.type, 'sv'));
  const customers = await sql<{ id: number; name: string }[]>`SELECT id, name FROM customers WHERE company_id = ${companyId} ORDER BY name LIMIT 500`;
  const [{ ledger }] = await sql<{ ledger: number }[]>`SELECT COALESCE(SUM(l.credit - l.debit), 0)::float8 AS ledger FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id WHERE v.company_id = ${companyId} AND l.account_number = ${DEPOSIT_LIABILITY}`;
  return { types, rows, customers, total: rows.reduce((s, r) => s + r.value, 0), ledger };
}

export async function addType(actor: Actor, input: Record<string, unknown>) {
  const deposit = parseAmount(String(input.deposit ?? '').trim());
  if (deposit == null || deposit <= 0) throw new ValidationError('Ange panten i kronor per förpackning');
  try {
    const [t] = await sql<{ id: number }[]>`INSERT INTO packaging_types ${sql({ company_id: actor.companyId, name: str(input, 'name', { required: true, label: 'Förpackningstyp', max: 100 }), deposit })} RETURNING id`;
    return t.id;
  } catch (e) { if (String((e as Error).message).includes('packaging_types_company_id_name_key')) throw new ConflictError('Förpackningstypen finns redan'); throw e; }
}

const lookup = async (tx: Tx, actor: Actor, input: Record<string, unknown>) => {
  const customerId = int(input, 'customer_id', 'Kund'), typeId = int(input, 'type_id', 'Förpackningstyp');
  const [c] = await tx<{ name: string }[]>`SELECT name FROM customers WHERE id = ${customerId} AND company_id = ${actor.companyId}`;
  if (!c) throw new NotFoundError('Kunden');
  const [t] = await tx<{ name: string; deposit: number }[]>`SELECT name, deposit::float8 AS deposit FROM packaging_types WHERE id = ${typeId} AND company_id = ${actor.companyId} FOR UPDATE`;
  if (!t) throw new NotFoundError('Förpackningstypen');
  await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${DEPOSIT_LIABILITY}, 'Pantskuld returemballage') ON CONFLICT DO NOTHING`;
  return { customerId, typeId, customer: c.name, type: t.name, deposit: t.deposit };
};

/** Utlämnat emballage: fakturautkast med panten som egen rad utan moms mot pantskulden (ingen intäkt) */
export async function deliver(actor: Actor, input: Record<string, unknown>) {
  const q = qty(input.quantity), d = date(input, 'date', 'Datum');
  return sql.begin(async (tx) => {
    const x = await lookup(tx, actor, input);
    const inv = await saveDraftTx(tx, actor, null, { customer_id: x.customerId, invoice_date: d, notes: 'Pant för returemballage – återbetalas när emballaget lämnas tillbaka.',
      lines: [{ description: `Pant ${x.type} (returemballage)`, quantity: q, unit: 'st', unit_price: x.deposit, vat_rate: 0, account: DEPOSIT_LIABILITY }] });
    await tx`INSERT INTO packaging_movements ${tx({ company_id: actor.companyId, customer_id: x.customerId, type_id: x.typeId, date: d, kind: 'out', quantity: q, deposit: x.deposit, invoice_id: inv.id, created_by: actor.userId })}`;
    await auditBy(tx, actor, 'packaging_out', 'customer', x.customerId, { type: x.type, quantity: q });
    return inv.id;
  });
}

/** Returnerat emballage: kreditfakturautkast för panten */
export async function returnPackaging(actor: Actor, input: Record<string, unknown>) {
  const q = qty(input.quantity), d = date(input, 'date', 'Datum');
  return sql.begin(async (tx) => {
    const x = await lookup(tx, actor, input);
    const out = await balance(tx, actor.companyId, x.customerId, x.typeId);
    if (q > out) throw new ValidationError(`${x.customer} har bara ${out} ${x.type} utlämnade`);
    const inv = await saveDraftTx(tx, actor, null, { customer_id: x.customerId, invoice_date: d, notes: 'Återbetald pant för returnerat emballage.',
      lines: [{ description: `Returnerad pant ${x.type}`, quantity: -q, unit: 'st', unit_price: x.deposit, vat_rate: 0, account: DEPOSIT_LIABILITY }] });
    await tx`INSERT INTO packaging_movements ${tx({ company_id: actor.companyId, customer_id: x.customerId, type_id: x.typeId, date: d, kind: 'return', quantity: q, deposit: x.deposit, invoice_id: inv.id, created_by: actor.userId })}`;
    await auditBy(tx, actor, 'packaging_return', 'customer', x.customerId, { type: x.type, quantity: q });
    return inv.id;
  });
}

/** Emballage som inte kommer tillbaka: panten förverkas och tas upp som intäkt */
export async function forfeit(actor: Actor, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum');
  return sql.begin(async (tx) => {
    const x = await lookup(tx, actor, input);
    const out = await balance(tx, actor.companyId, x.customerId, x.typeId);
    const q = String(input.quantity ?? '').trim() ? qty(input.quantity) : out;
    if (!out || q > out) throw new ValidationError(`${x.customer} har ${out} ${x.type} utlämnade`);
    const amount = q * x.deposit;
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${FORFEIT_INCOME}, 'Övriga ersättningar och intäkter') ON CONFLICT DO NOTHING`;
    const v = await createVoucher(tx, { actor, date: d, description: `Förverkad pant: ${q} ${x.type}, ${x.customer}`, lines: fromSigned(forfeitLines(amount)), sourceType: 'packaging' });
    await tx`INSERT INTO packaging_movements ${tx({ company_id: actor.companyId, customer_id: x.customerId, type_id: x.typeId, date: d, kind: 'forfeit', quantity: q, deposit: x.deposit, voucher_id: v.id, created_by: actor.userId })}`;
    await auditBy(tx, actor, 'packaging_forfeit', 'customer', x.customerId, { type: x.type, quantity: q, amount });
    return { quantity: q, amount, signed: signedQty('forfeit', q) };
  });
}
