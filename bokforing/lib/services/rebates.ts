import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { kr, today } from '@/lib/format';
import { CUSTOMER_ACCRUAL_ACCOUNT, CUSTOMER_REBATE_ACCOUNT, customerAccrualLines, parseTiers, rebate, type Tier } from '@/lib/rebates';
import type { Actor } from './actor';
import { saveDraftTx } from './invoices';
import { date, int, str } from './input';

type Db = Tx | typeof sql;
interface Agreement { id: number; party_id: number; party: string; start: string; end: string; tiers: Tier[]; vat_rate: number; note: string; settled_amount: number | null; settled_at: string | null; settled_invoice_id: number | null }

const agreements = (db: Db, companyId: number, id?: number) => db<Agreement[]>`
  SELECT a.id, a.customer_id AS party_id, c.name AS party, to_char(a.start_date,'YYYY-MM-DD') AS start, to_char(a.end_date,'YYYY-MM-DD') AS end, a.tiers, a.vat_rate, a.note,
    a.settled_amount::float8 AS settled_amount, to_char(a.settled_at,'YYYY-MM-DD') AS settled_at, a.settled_invoice_id
  FROM rebate_agreements a JOIN customers c ON c.id = a.customer_id
  WHERE a.company_id = ${companyId} AND a.kind = 'customer' ${id ? db`AND a.id = ${id}` : db``} ORDER BY a.end_date DESC, c.name`;

/** Fakturerad omsättning exkl. moms (i kronor, SEK) under perioden – bonusfakturorna själva räknas inte */
async function volume(db: Db, companyId: number, customerId: number, from: string, to: string) {
  const [{ v }] = await db<{ v: number }[]>`SELECT COALESCE(SUM(i.total_net), 0)::float8 AS v FROM invoices i
    WHERE i.company_id = ${companyId} AND i.customer_id = ${customerId} AND i.status IN ('booked','paid','credited')
      AND i.invoice_date BETWEEN ${from} AND ${to}
      AND NOT EXISTS (SELECT 1 FROM rebate_agreements r WHERE r.settled_invoice_id = i.id)`;
  return v;
}

const accrued = async (db: Db, agreementId: number) => {
  const [{ s }] = await db<{ s: number }[]>`SELECT COALESCE(SUM(amount), 0)::float8 AS s FROM rebate_accruals WHERE agreement_id = ${agreementId}`;
  return s;
};

export async function overview(companyId: number) {
  const t = today();
  const list = await agreements(sql, companyId);
  const rows = [];
  for (const a of list) {
    const to = a.end < t ? a.end : t;
    const vol = a.start <= to ? await volume(sql, companyId, a.party_id, a.start, to) : 0;
    rows.push({ ...a, volume: vol, ...rebate(vol, a.tiers), accrued: a.settled_at ? 0 : await accrued(sql, a.id), ended: a.end < t });
  }
  const customers = await sql<{ id: number; name: string }[]>`SELECT id, name FROM customers WHERE company_id = ${companyId} ORDER BY name`;
  const fys = await sql<{ id: number; start: string; end: string; closed: boolean }[]>`SELECT id, to_char(start_date,'YYYY-MM-DD') AS start, to_char(end_date,'YYYY-MM-DD') AS end, closed FROM fiscal_years WHERE company_id = ${companyId} ORDER BY start_date DESC`;
  return { rows, customers, fys };
}

export async function addAgreement(actor: Actor, input: Record<string, unknown>) {
  const customerId = int(input, 'customer_id', 'Kund');
  const [c] = await sql`SELECT 1 FROM customers WHERE id = ${customerId} AND company_id = ${actor.companyId}`;
  if (!c) throw new ValidationError('Kunden finns inte');
  const start = date(input, 'start_date', 'Från'), end = date(input, 'end_date', 'Till');
  if (end < start) throw new ValidationError('Slutdatum måste vara efter startdatum');
  let tiers: Tier[];
  try { tiers = parseTiers(str(input, 'tiers', { required: true, label: 'Trappsteg', max: 500 })); } catch (e) { throw new ValidationError((e as Error).message); }
  const vat = Number(input.vat_rate ?? 25);
  if (![0, 6, 12, 25].includes(vat)) throw new ValidationError('Ogiltig momssats');
  const [r] = await sql<{ id: number }[]>`INSERT INTO rebate_agreements ${sql({ company_id: actor.companyId, kind: 'customer', customer_id: customerId, start_date: start, end_date: end, tiers: sql.json(tiers as never), vat_rate: vat, note: str(input, 'note', { max: 300 }), created_by: actor.userId })} RETURNING id`;
  await auditBy(sql, actor, 'rebate_agreement', 'rebate_agreement', r.id, { customer_id: customerId, start, end });
  return r.id;
}

/** Upplupen kundbonus per bokslutsdagen: intjänad bonus på omsättningen hittills, ändringen mot tidigare upplupet bokförs */
export async function accrue(actor: Actor, fyId: number) {
  return sql.begin(async (tx) => {
    const [fy] = await tx<{ start: string; end: string; closed: boolean }[]>`SELECT to_char(start_date,'YYYY-MM-DD') AS start, to_char(end_date,'YYYY-MM-DD') AS end, closed FROM fiscal_years WHERE id = ${fyId} AND company_id = ${actor.companyId}`;
    if (!fy) throw new NotFoundError('Räkenskapsåret');
    if (fy.closed) throw new ConflictError('Räkenskapsåret är stängt');
    await tx`SELECT 1 FROM companies WHERE id = ${actor.companyId} FOR UPDATE`;
    const changes: { id: number; change: number }[] = [];
    for (const a of await agreements(tx, actor.companyId)) {
      if (a.settled_at || a.start > fy.end) continue;
      const to = a.end < fy.end ? a.end : fy.end;
      const target = rebate(await volume(tx, actor.companyId, a.party_id, a.start, to), a.tiers).amount;
      const change = target - await accrued(tx, a.id);
      if (change) changes.push({ id: a.id, change });
    }
    const total = changes.reduce((s, c) => s + c.change, 0);
    if (!changes.length) throw new ValidationError('Den upplupna bonusen stämmer redan');
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${CUSTOMER_REBATE_ACCOUNT}, 'Lämnade rabatter'), (${actor.companyId}, ${CUSTOMER_ACCRUAL_ACCOUNT}, 'Övriga upplupna kostnader och förutbetalda intäkter') ON CONFLICT DO NOTHING`;
    const v = await createVoucher(tx, { actor, date: fy.end, description: 'Upplupen kundbonus', sourceType: 'rebate', sourceId: null,
      lines: fromSigned(changes.flatMap((c) => customerAccrualLines(c.change))) });
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
    const [a] = await agreements(tx, actor.companyId, agreementId);
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
