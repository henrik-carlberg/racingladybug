import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { kr, today } from '@/lib/format';
import { CUSTOMER_ACCRUAL_ACCOUNT, CUSTOMER_REBATE_ACCOUNT, SUPPLIER_ACCRUAL_ACCOUNT, SUPPLIER_REBATE_ACCOUNT, customerAccrualLines, parseTiers, rebate, supplierAccrualLines, supplierSettlementLines, type Tier } from '@/lib/rebates';
import type { Actor } from './actor';
import { saveDraftTx } from './invoices';
import { date, int, str } from './input';

type Db = Tx | typeof sql;
interface Agreement { id: number; party_id: number; party: string; start: string; end: string; tiers: Tier[]; vat_rate: number; note: string; settled_amount: number | null; settled_at: string | null; settled_invoice_id: number | null }

export type Kind = 'customer' | 'supplier';
const agreements = (db: Db, companyId: number, kind: Kind = 'customer', id?: number) => db<Agreement[]>`
  SELECT a.id, COALESCE(a.customer_id, a.supplier_id) AS party_id, COALESCE(c.name, s.name) AS party, to_char(a.start_date,'YYYY-MM-DD') AS start, to_char(a.end_date,'YYYY-MM-DD') AS end, a.tiers, a.vat_rate, a.note,
    a.settled_amount::float8 AS settled_amount, to_char(a.settled_at,'YYYY-MM-DD') AS settled_at, a.settled_invoice_id
  FROM rebate_agreements a LEFT JOIN customers c ON c.id = a.customer_id LEFT JOIN suppliers s ON s.id = a.supplier_id
  WHERE a.company_id = ${companyId} AND a.kind = ${kind} ${id ? db`AND a.id = ${id}` : db``} ORDER BY a.end_date DESC, 2`;

/** Inköp exkl. moms från leverantören under perioden, minus kreditnotor (utom bonusens egen kreditnota) */
async function supplierVolume(db: Db, companyId: number, supplierId: number, from: string, to: string) {
  const [{ v }] = await db<{ v: number }[]>`SELECT (COALESCE((SELECT SUM(total - vat) FROM supplier_invoices WHERE company_id = ${companyId} AND supplier_id = ${supplierId} AND voucher_id IS NOT NULL AND invoice_date BETWEEN ${from} AND ${to}), 0)
    - COALESCE((SELECT SUM(c.total - c.vat) FROM supplier_credits c WHERE c.company_id = ${companyId} AND c.supplier_id = ${supplierId} AND c.date BETWEEN ${from} AND ${to}
        AND NOT EXISTS (SELECT 1 FROM rebate_agreements r WHERE r.settled_voucher_id = c.voucher_id)), 0))::float8 AS v`;
  return v;
}

/** Fakturerad omsättning exkl. moms (i kronor, SEK) under perioden – bonusfakturorna själva räknas inte */
async function volume(db: Db, companyId: number, customerId: number, from: string, to: string, kind: Kind = 'customer') {
  if (kind === 'supplier') return supplierVolume(db, companyId, customerId, from, to);
  const [{ v }] = await db<{ v: number }[]>`SELECT COALESCE(SUM(i.total_net), 0)::float8 AS v FROM invoices i
    WHERE i.company_id = ${companyId} AND i.customer_id = ${customerId} AND i.status IN ('booked','paid','credited')
      AND i.invoice_date BETWEEN ${from} AND ${to}
      AND NOT EXISTS (SELECT 1 FROM rebate_agreements r WHERE r.settled_invoice_id = i.id)`;
  return v;
}

const ensureAccounts = (tx: Tx, companyId: number) => tx`INSERT INTO accounts (company_id, number, name) VALUES (${companyId}, ${CUSTOMER_REBATE_ACCOUNT}, 'Lämnade rabatter'),
  (${companyId}, ${CUSTOMER_ACCRUAL_ACCOUNT}, 'Övriga upplupna kostnader och förutbetalda intäkter'), (${companyId}, ${SUPPLIER_REBATE_ACCOUNT}, 'Erhållna rabatter'),
  (${companyId}, ${SUPPLIER_ACCRUAL_ACCOUNT}, 'Övriga förutbetalda kostnader och upplupna intäkter') ON CONFLICT DO NOTHING`;

const accrued = async (db: Db, agreementId: number) => {
  const [{ s }] = await db<{ s: number }[]>`SELECT COALESCE(SUM(amount), 0)::float8 AS s FROM rebate_accruals WHERE agreement_id = ${agreementId}`;
  return s;
};

export async function overview(companyId: number, kind: Kind = 'customer') {
  const t = today();
  const list = await agreements(sql, companyId, kind);
  const rows = [];
  for (const a of list) {
    const to = a.end < t ? a.end : t;
    const vol = a.start <= to ? await volume(sql, companyId, a.party_id, a.start, to, kind) : 0;
    rows.push({ ...a, volume: vol, ...rebate(vol, a.tiers), accrued: a.settled_at ? 0 : await accrued(sql, a.id), ended: a.end < t });
  }
  const customers = kind === 'customer' ? await sql<{ id: number; name: string }[]>`SELECT id, name FROM customers WHERE company_id = ${companyId} ORDER BY name`
    : await sql<{ id: number; name: string }[]>`SELECT id, name FROM suppliers WHERE company_id = ${companyId} ORDER BY name`;
  const fys = await sql<{ id: number; start: string; end: string; closed: boolean }[]>`SELECT id, to_char(start_date,'YYYY-MM-DD') AS start, to_char(end_date,'YYYY-MM-DD') AS end, closed FROM fiscal_years WHERE company_id = ${companyId} ORDER BY start_date DESC`;
  return { rows, customers, fys };
}

export async function addAgreement(actor: Actor, input: Record<string, unknown>, kind: Kind = 'customer') {
  const customerId = int(input, kind === 'customer' ? 'customer_id' : 'supplier_id', kind === 'customer' ? 'Kund' : 'Leverantör');
  const [c] = kind === 'customer' ? await sql`SELECT 1 FROM customers WHERE id = ${customerId} AND company_id = ${actor.companyId}`
    : await sql`SELECT 1 FROM suppliers WHERE id = ${customerId} AND company_id = ${actor.companyId}`;
  if (!c) throw new ValidationError(kind === 'customer' ? 'Kunden finns inte' : 'Leverantören finns inte');
  const start = date(input, 'start_date', 'Från'), end = date(input, 'end_date', 'Till');
  if (end < start) throw new ValidationError('Slutdatum måste vara efter startdatum');
  let tiers: Tier[];
  try { tiers = parseTiers(str(input, 'tiers', { required: true, label: 'Trappsteg', max: 500 })); } catch (e) { throw new ValidationError((e as Error).message); }
  const vat = Number(input.vat_rate ?? 25);
  if (![0, 6, 12, 25].includes(vat)) throw new ValidationError('Ogiltig momssats');
  const [r] = await sql<{ id: number }[]>`INSERT INTO rebate_agreements ${sql({ company_id: actor.companyId, kind, customer_id: kind === 'customer' ? customerId : null, supplier_id: kind === 'supplier' ? customerId : null, start_date: start, end_date: end, tiers: sql.json(tiers as never), vat_rate: vat, note: str(input, 'note', { max: 300 }), created_by: actor.userId })} RETURNING id`;
  await auditBy(sql, actor, 'rebate_agreement', 'rebate_agreement', r.id, { kind, party_id: customerId, start, end });
  return r.id;
}

/** Upplupen kundbonus per bokslutsdagen: intjänad bonus på omsättningen hittills, ändringen mot tidigare upplupet bokförs */
export async function accrue(actor: Actor, fyId: number, kind: Kind = 'customer') {
  return sql.begin(async (tx) => {
    const [fy] = await tx<{ start: string; end: string; closed: boolean }[]>`SELECT to_char(start_date,'YYYY-MM-DD') AS start, to_char(end_date,'YYYY-MM-DD') AS end, closed FROM fiscal_years WHERE id = ${fyId} AND company_id = ${actor.companyId}`;
    if (!fy) throw new NotFoundError('Räkenskapsåret');
    if (fy.closed) throw new ConflictError('Räkenskapsåret är stängt');
    await tx`SELECT 1 FROM companies WHERE id = ${actor.companyId} FOR UPDATE`;
    const changes: { id: number; change: number }[] = [];
    for (const a of await agreements(tx, actor.companyId, kind)) {
      if (a.settled_at || a.start > fy.end) continue;
      const to = a.end < fy.end ? a.end : fy.end;
      const target = rebate(await volume(tx, actor.companyId, a.party_id, a.start, to, kind), a.tiers).amount;
      const change = target - await accrued(tx, a.id);
      if (change) changes.push({ id: a.id, change });
    }
    const total = changes.reduce((s, c) => s + c.change, 0);
    if (!changes.length) throw new ValidationError('Den upplupna bonusen stämmer redan');
    await ensureAccounts(tx, actor.companyId);
    const v = await createVoucher(tx, { actor, date: fy.end, description: kind === 'customer' ? 'Upplupen kundbonus' : 'Upplupen leverantörsbonus', sourceType: 'rebate', sourceId: null,
      lines: fromSigned(changes.flatMap((c) => (kind === 'customer' ? customerAccrualLines : supplierAccrualLines)(c.change))) });
    for (const c of changes) await tx`INSERT INTO rebate_accruals ${tx({ agreement_id: c.id, fiscal_year_id: fyId, amount: c.change, voucher_id: v.id })}`;
    await auditBy(tx, actor, 'rebate_accrual', 'voucher', v.id, { total });
    return total;
  });
}

/** Perioden är slut: bonusen krediteras kunden med ett fakturautkast (momsen sätts ned), det upplupna lösas upp */
export async function settle(actor: Actor, agreementId: number, input: Record<string, unknown>) {
  return sql.begin(async (tx) => {
    const [lock] = await tx`SELECT 1 FROM rebate_agreements WHERE id = ${agreementId} AND company_id = ${actor.companyId} AND kind = 'customer' FOR UPDATE`;
    if (!lock) throw new NotFoundError('Bonusavtalet');
    const [a] = await agreements(tx, actor.companyId, 'customer', agreementId);
    if (a.settled_at) throw new ConflictError('Bonusen är redan reglerad');
    const d = date(input, 'date', 'Datum');
    if (d <= a.end) throw new ValidationError(`Bonusen regleras när perioden är slut (efter ${a.end})`);
    const vol = await volume(tx, actor.companyId, a.party_id, a.start, a.end);
    const r = rebate(vol, a.tiers);
    const acc = await accrued(tx, a.id);
    let invoiceId: number | null = null;
    if (r.amount > 0) {
      const inv = await saveDraftTx(tx, actor, null, { customer_id: a.party_id, invoice_date: d, lines: [{ description: `Bonus ${a.start}–${a.end}: ${r.pct / 100} % av ${kr(vol)} kr`, quantity: -1, unit: 'st', unit_price: r.amount, vat_rate: a.vat_rate, account: CUSTOMER_REBATE_ACCOUNT }] });
      invoiceId = inv.id;
    }
    let voucherId: number | null = null;
    if (acc) {
      const v = await createVoucher(tx, { actor, date: d, description: `Upplöst upplupen kundbonus, ${a.party}`, sourceType: 'rebate', sourceId: a.id, lines: fromSigned(customerAccrualLines(-acc)) });
      voucherId = v.id;
    }
    await tx`UPDATE rebate_agreements SET settled_amount = ${r.amount}, settled_at = ${d}, settled_invoice_id = ${invoiceId}, settled_voucher_id = ${voucherId} WHERE id = ${a.id}`;
    await auditBy(tx, actor, 'rebate_settled', 'rebate_agreement', a.id, { amount: r.amount, accrued: acc, invoice_id: invoiceId });
    return { amount: r.amount, invoiceId };
  });
}

/** Leverantörsbonusen för perioden tas emot: utbetald till banken eller som kreditnota (minskar leverantörsskulden). Ingående moms sätts ned och den upplupna fordran löses upp. */
export async function receiveSupplierRebate(actor: Actor, agreementId: number, input: Record<string, unknown>) {
  const method = input.method === 'credit' ? 'credit' : 'bank';
  const d = date(input, 'date', 'Datum');
  const creditNo = method === 'credit' ? str(input, 'credit_number', { required: true, label: 'Kreditnotans nummer', max: 60 }) : '';
  return sql.begin(async (tx) => {
    const [lock] = await tx`SELECT 1 FROM rebate_agreements WHERE id = ${agreementId} AND company_id = ${actor.companyId} AND kind = 'supplier' FOR UPDATE`;
    if (!lock) throw new NotFoundError('Bonusavtalet');
    const [a] = await agreements(tx, actor.companyId, 'supplier', agreementId);
    if (a.settled_at) throw new ConflictError('Bonusen är redan mottagen');
    if (d <= a.end) throw new ValidationError(`Bonusen tas emot när perioden är slut (efter ${a.end})`);
    const vol = await supplierVolume(tx, actor.companyId, a.party_id, a.start, a.end);
    const r = rebate(vol, a.tiers);
    const acc = await accrued(tx, a.id);
    if (!r.amount && !acc) throw new ValidationError('Ingen bonus är intjänad och inget är upplupet');
    const vat = Math.round((r.amount * a.vat_rate) / 100);
    await ensureAccounts(tx, actor.companyId);
    const v = await createVoucher(tx, { actor, date: d, description: `Leverantörsbonus ${a.start}–${a.end}, ${a.party}`, sourceType: 'rebate', sourceId: a.id,
      lines: fromSigned(supplierSettlementLines(r.amount, vat, acc, method)) });
    if (method === 'credit' && r.amount > 0) {
      await tx`INSERT INTO supplier_credits ${tx({ company_id: actor.companyId, supplier_id: a.party_id, credit_number: creditNo, date: d, total: r.amount + vat, vat, voucher_id: v.id, created_by: actor.userId })}`
        .catch((e) => { if (String((e as Error).message).includes('credit_number_key')) throw new ConflictError('Kreditnotan är redan registrerad'); throw e; });
    }
    await tx`UPDATE rebate_agreements SET settled_amount = ${r.amount}, settled_at = ${d}, settled_voucher_id = ${v.id} WHERE id = ${a.id}`;
    await auditBy(tx, actor, 'supplier_rebate_received', 'rebate_agreement', a.id, { amount: r.amount, vat, accrued: acc, method });
    return { amount: r.amount, vat, method };
  });
}
