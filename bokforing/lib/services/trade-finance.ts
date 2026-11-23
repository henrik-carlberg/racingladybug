import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { BANK_FEES, DEFAULT_DOCS, KINDS, commitmentsFor, daysLeft, docsReady, feeLines } from '@/lib/trade-finance';
import type { Actor } from './actor';
import { date, int, str } from './input';

type Row = { id: number; kind: string; counterparty: string; bank: string; reference: string; currency: string; amount: number; amount_sek: number; issued_on: string; expires_on: string; documents: { name: string; done: boolean }[]; blocked: number; status: string; closed_on: string | null; guarantee_commitment_id: number | null; pledge_commitment_id: number | null };
const COLS = sql`id, kind, counterparty, bank, reference, currency, amount::float8 AS amount, amount_sek::float8 AS amount_sek, to_char(issued_on,'YYYY-MM-DD') AS issued_on, to_char(expires_on,'YYYY-MM-DD') AS expires_on,
  documents, blocked::float8 AS blocked, status, to_char(closed_on,'YYYY-MM-DD') AS closed_on, guarantee_commitment_id, pledge_commitment_id`;

export async function overview(companyId: number) {
  const t = today();
  const rows = await sql<Row[]>`SELECT ${COLS} FROM trade_finance WHERE company_id = ${companyId} ORDER BY status = 'open' DESC, expires_on`;
  const fees = await sql<{ trade_finance_id: number; total: number }[]>`SELECT f.trade_finance_id, SUM(f.amount)::float8 AS total FROM trade_finance_fees f JOIN trade_finance x ON x.id = f.trade_finance_id
    WHERE x.company_id = ${companyId} GROUP BY f.trade_finance_id`;
  const open = rows.filter((r) => r.status === 'open');
  return {
    items: rows.map((r) => ({ ...r, fees: fees.find((f) => f.trade_finance_id === r.id)?.total ?? 0, daysLeft: daysLeft(r.expires_on, t), ready: docsReady(r.documents) })),
    guaranteesGiven: open.filter((r) => r.kind === 'guarantee_given').reduce((s, r) => s + r.amount_sek, 0),
    blocked: open.reduce((s, r) => s + r.blocked, 0),
    expiring: open.filter((r) => daysLeft(r.expires_on, t) <= 30).length,
  };
}

export async function create(actor: Actor, input: Record<string, unknown>) {
  const kind = Object.prototype.hasOwnProperty.call(KINDS, String(input.kind)) ? String(input.kind) : '';
  if (!kind) throw new ValidationError('Välj typ');
  const currency = (str(input, 'currency') || 'SEK').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new ValidationError('Ange valutan med tre bokstäver');
  const amount = Number(String(input.amount ?? '').replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) throw new ValidationError('Ange beloppet');
  const sek = currency === 'SEK' ? Math.round(amount * 100) : parseAmount(String(input.amount_sek ?? '').trim());
  if (sek == null || sek <= 0) throw new ValidationError('Ange motvärdet i kronor');
  const blocked = String(input.blocked ?? '').trim() ? parseAmount(String(input.blocked)) : 0;
  if (blocked == null || blocked < 0) throw new ValidationError('Ogiltigt spärrat belopp');
  const issued = date(input, 'issued_on', 'Utfärdad'), expires = date(input, 'expires_on', 'Giltig till');
  if (expires < issued) throw new ValidationError('Giltighetstiden slutar före utfärdandet');
  const counterparty = str(input, 'counterparty', { required: true, label: 'Motpart', max: 200 });
  const docs = String(input.documents ?? '').trim() ? String(input.documents).split(/[\n;]/).map((s) => s.trim()).filter(Boolean) : DEFAULT_DOCS[kind];
  return sql.begin(async (tx) => {
    const c = commitmentsFor(kind, sek, blocked);
    const commit = async (k: string, a: number, d: string) => (await tx<{ id: number }[]>`INSERT INTO commitments ${tx({ company_id: actor.companyId, kind: k, description: d, beneficiary: counterparty, amount: a, from_date: issued, to_date: null, created_by: actor.userId })} RETURNING id`)[0].id;
    const g = c.guarantee ? await commit('guarantee', c.guarantee, `Bankgaranti ${str(input, 'reference') || ''} till ${counterparty}`.replace('  ', ' ')) : null;
    const p = c.pledge ? await commit('pledged_asset', c.pledge, `Spärrade bankmedel som säkerhet för ${KINDS[kind].toLowerCase()} ${counterparty}`) : null;
    const [r] = await tx<{ id: number }[]>`INSERT INTO trade_finance ${tx({ company_id: actor.companyId, kind, counterparty, bank: str(input, 'bank', { max: 100 }), reference: str(input, 'reference', { max: 60 }), currency, amount, amount_sek: sek,
      issued_on: issued, expires_on: expires, documents: tx.json(docs.map((n) => ({ name: n, done: false }))), blocked, guarantee_commitment_id: g, pledge_commitment_id: p, created_by: actor.userId })} RETURNING id`;
    await auditBy(tx, actor, 'trade_finance', 'trade_finance', r.id, { kind, sek });
    return { id: r.id, guarantee: c.guarantee, pledge: c.pledge };
  });
}

const lock = async (tx: Tx, actor: Actor, id: number) => {
  const [r] = await tx<Row[]>`SELECT ${COLS} FROM trade_finance WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
  if (!r) throw new NotFoundError('Rembursen eller garantin');
  return r;
};

export async function toggleDocument(actor: Actor, id: number, input: Record<string, unknown>) {
  const idx = int(input, 'index', 'Dokument');
  return sql.begin(async (tx) => {
    const r = await lock(tx, actor, id);
    if (r.status !== 'open') throw new ConflictError('Ärendet är avslutat');
    if (idx < 0 || idx >= r.documents.length) throw new NotFoundError('Dokumentet');
    const docs = r.documents.map((d, i) => (i === idx ? { ...d, done: !d.done } : d));
    await tx`UPDATE trade_finance SET documents = ${tx.json(docs)} WHERE id = ${id}`;
    return docsReady(docs);
  });
}

export async function addFee(actor: Actor, id: number, input: Record<string, unknown>) {
  const amount = parseAmount(String(input.amount ?? '').trim());
  if (amount == null || amount <= 0) throw new ValidationError('Ange avgiften i kronor');
  const d = date(input, 'date', 'Datum', false) || today();
  return sql.begin(async (tx) => {
    const r = await lock(tx, actor, id);
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${BANK_FEES}, 'Bankkostnader') ON CONFLICT DO NOTHING`;
    const v = await createVoucher(tx, { actor, date: d, description: `Bankavgift ${KINDS[r.kind].toLowerCase()} ${r.reference || r.counterparty}`, lines: fromSigned(feeLines(amount)), sourceType: 'trade_finance', sourceId: id });
    await tx`INSERT INTO trade_finance_fees ${tx({ trade_finance_id: id, date: d, amount, description: str(input, 'description', { max: 200 }), voucher_id: v.id })}`;
    return amount;
  });
}

/** Utnyttjad, avslutad eller förfallen: ansvarsförbindelsen och den ställda säkerheten upphör */
export async function close(actor: Actor, id: number, status: 'utilized' | 'closed' | 'expired', input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum', false) || today();
  return sql.begin(async (tx) => {
    const r = await lock(tx, actor, id);
    if (r.status !== 'open') throw new ConflictError('Ärendet är redan avslutat');
    if (status === 'utilized' && r.kind.startsWith('lc_') && !docsReady(r.documents)) throw new ValidationError('Alla dokument enligt rembursvillkoren är inte klara');
    for (const c of [r.guarantee_commitment_id, r.pledge_commitment_id]) if (c) await tx`UPDATE commitments SET to_date = GREATEST(from_date, ${d}::date) WHERE id = ${c} AND company_id = ${actor.companyId}`;
    await tx`UPDATE trade_finance SET status = ${status}, closed_on = ${d} WHERE id = ${id}`;
    await auditBy(tx, actor, `trade_finance_${status}`, 'trade_finance', id);
  });
}
