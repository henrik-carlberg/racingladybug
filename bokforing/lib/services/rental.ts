import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { parseAmount } from '@/lib/money';
import { addDays, billingPeriod, rentFor, utilization } from '@/lib/rental';
import { today } from '@/lib/format';
import type { Actor } from './actor';
import { date, int, str } from './input';
import { saveDraftTx } from './invoices';

const kr = (v: unknown, label: string, optional = false) => {
  const s = String(v ?? '').trim();
  if (!s && optional) return null;
  const n = parseAmount(s);
  if (n == null || n <= 0) throw new ValidationError(`Ange ${label} i kronor`);
  return n;
};

export async function overview(companyId: number) {
  const t = today(), from = addDays(t, -89);
  const items = await sql<{ id: number; serial: string; name: string; day_rate: number; week_rate: number | null; month_rate: number | null; vat_rate: number }[]>`
    SELECT id, serial, name, day_rate::float8 AS day_rate, week_rate::float8 AS week_rate, month_rate::float8 AS month_rate, vat_rate FROM rental_items WHERE company_id = ${companyId} AND active ORDER BY serial`;
  const contracts = await sql<{ id: number; item_id: number; customer: string; customer_id: number; start: string; expected_end: string | null; returned_on: string | null; invoiced_until: string | null; note: string }[]>`
    SELECT r.id, r.item_id, c.name AS customer, r.customer_id, to_char(r.start_date,'YYYY-MM-DD') AS start, to_char(r.expected_end,'YYYY-MM-DD') AS expected_end,
      to_char(r.returned_on,'YYYY-MM-DD') AS returned_on, to_char(r.invoiced_until,'YYYY-MM-DD') AS invoiced_until, r.note
    FROM rental_contracts r JOIN customers c ON c.id = r.customer_id WHERE r.company_id = ${companyId} ORDER BY r.start_date DESC, r.id DESC`;
  const revenue = await sql<{ item_id: number; rent: number }[]>`SELECT r.item_id, SUM(ri.rent + ri.extras)::float8 AS rent FROM rental_invoices ri JOIN rental_contracts r ON r.id = ri.contract_id WHERE r.company_id = ${companyId} GROUP BY r.item_id`;
  const customers = await sql<{ id: number; name: string }[]>`SELECT id, name FROM customers WHERE company_id = ${companyId} ORDER BY name LIMIT 500`;
  return {
    customers,
    items: items.map((i) => {
      const own = contracts.filter((c) => c.item_id === i.id);
      const current = own.find((c) => !c.returned_on) ?? null;
      const pending = own.filter((c) => billingPeriod({ start: c.start, invoicedUntil: c.invoiced_until, returnedOn: c.returned_on, until: t }));
      return { ...i, current, pending, overdue: !!current?.expected_end && current.expected_end < t, util: utilization(own.map((c) => ({ start: c.start, end: c.returned_on })), from, t), revenue: revenue.find((r) => r.item_id === i.id)?.rent ?? 0 };
    }),
  };
}

export async function addItem(actor: Actor, input: Record<string, unknown>) {
  const vat = Number(input.vat_rate ?? 25);
  if (![0, 6, 12, 25].includes(vat)) throw new ValidationError('Momssatsen ska vara 0, 6, 12 eller 25 %');
  try {
    const [i] = await sql<{ id: number }[]>`INSERT INTO rental_items ${sql({ company_id: actor.companyId, serial: str(input, 'serial', { required: true, label: 'Serienummer', max: 60 }), name: str(input, 'name', { required: true, label: 'Benämning', max: 200 }),
      day_rate: kr(input.day_rate, 'dagpriset')!, week_rate: kr(input.week_rate, 'veckopriset', true), month_rate: kr(input.month_rate, 'månadspriset', true), vat_rate: vat })} RETURNING id`;
    return i.id;
  } catch (e) { if (String((e as Error).message).includes('rental_items_company_id_serial_key')) throw new ConflictError('Serienumret finns redan'); throw e; }
}

/** Utlämning: individen kan bara vara uthyrd till en kund i taget */
export async function checkout(actor: Actor, itemId: number, input: Record<string, unknown>) {
  const customerId = int(input, 'customer_id', 'Kund');
  const [c] = await sql`SELECT 1 FROM customers WHERE id = ${customerId} AND company_id = ${actor.companyId}`;
  if (!c) throw new NotFoundError('Kunden');
  const [i] = await sql`SELECT 1 FROM rental_items WHERE id = ${itemId} AND company_id = ${actor.companyId} AND active`;
  if (!i) throw new NotFoundError('Utrustningen');
  const start = date(input, 'start_date', 'Utlämningsdag'), end = date(input, 'expected_end', 'Planerad återlämning', false) || null;
  if (end && end < start) throw new ValidationError('Planerad återlämning ska vara efter utlämningen');
  try {
    await sql`INSERT INTO rental_contracts ${sql({ company_id: actor.companyId, item_id: itemId, customer_id: customerId, start_date: start, expected_end: end, note: str(input, 'note', { max: 300 }), created_by: actor.userId })}`;
  } catch (e) { if (String((e as Error).message).includes('rental_contracts_one_out')) throw new ConflictError('Utrustningen är redan uthyrd'); throw e; }
}

/** Återlämning, eventuellt med tillägg för skada eller försening; hyran fram till återlämningen faktureras */
export async function checkin(actor: Actor, contractId: number, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Återlämningsdag');
  return sql.begin(async (tx) => {
    const [r] = await tx<{ start: string; returned_on: string | null }[]>`SELECT to_char(start_date,'YYYY-MM-DD') AS start, returned_on FROM rental_contracts WHERE id = ${contractId} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!r) throw new NotFoundError('Hyresavtalet');
    if (r.returned_on) throw new ConflictError('Utrustningen är redan återlämnad');
    if (d < r.start) throw new ValidationError('Återlämningen kan inte vara före utlämningen');
    await tx`UPDATE rental_contracts SET returned_on = ${d} WHERE id = ${contractId}`;
    return invoiceTx(tx, actor, contractId, d, { damage: kr(input.damage, 'skadeavgiften', true), late: kr(input.late, 'förseningsavgiften', true), note: str(input, 'damage_note', { max: 200 }) });
  });
}

async function invoiceTx(tx: Tx, actor: Actor, contractId: number, until: string, extra: { damage: number | null; late: number | null; note: string } = { damage: null, late: null, note: '' }) {
  const [r] = await tx<{ item_id: number; customer_id: number; start: string; invoiced_until: string | null; returned_on: string | null; serial: string; name: string; day_rate: number; week_rate: number | null; month_rate: number | null; vat_rate: number }[]>`
    SELECT r.item_id, r.customer_id, to_char(r.start_date,'YYYY-MM-DD') AS start, to_char(r.invoiced_until,'YYYY-MM-DD') AS invoiced_until, to_char(r.returned_on,'YYYY-MM-DD') AS returned_on,
      i.serial, i.name, i.day_rate::float8 AS day_rate, i.week_rate::float8 AS week_rate, i.month_rate::float8 AS month_rate, i.vat_rate
    FROM rental_contracts r JOIN rental_items i ON i.id = r.item_id WHERE r.id = ${contractId} AND r.company_id = ${actor.companyId} FOR UPDATE OF r`;
  if (!r) throw new NotFoundError('Hyresavtalet');
  const p = billingPeriod({ start: r.start, invoicedUntil: r.invoiced_until, returnedOn: r.returned_on, until });
  const rent = p ? rentFor(p.days, { day: r.day_rate, week: r.week_rate, month: r.month_rate }) : 0;
  const lines = [
    ...(p ? [{ description: `Hyra ${r.serial} ${r.name} ${p.from}–${p.to} (${p.days} ${p.days === 1 ? 'dag' : 'dagar'})`, quantity: 1, unit: 'st', unit_price: rent, vat_rate: r.vat_rate }] : []),
    ...(extra.damage ? [{ description: `Skadeavgift ${r.serial}${extra.note ? `: ${extra.note}` : ''}`, quantity: 1, unit: 'st', unit_price: extra.damage, vat_rate: r.vat_rate }] : []),
    ...(extra.late ? [{ description: `Förseningsavgift ${r.serial}`, quantity: 1, unit: 'st', unit_price: extra.late, vat_rate: r.vat_rate }] : []),
  ];
  if (!lines.length) return { invoiceId: null, rent: 0 };
  const inv = await saveDraftTx(tx, actor, null, { customer_id: r.customer_id, invoice_date: until > today() ? today() : until, lines });
  if (p) await tx`UPDATE rental_contracts SET invoiced_until = ${p.to} WHERE id = ${contractId}`;
  await tx`INSERT INTO rental_invoices ${tx({ contract_id: contractId, invoice_id: inv.id, period_from: p?.from ?? until, period_to: p?.to ?? until, rent, extras: (extra.damage ?? 0) + (extra.late ?? 0) })}`;
  await auditBy(tx, actor, 'rental_invoiced', 'rental_contract', contractId, { rent, period: p });
  return { invoiceId: inv.id, rent };
}

/** Pågående hyra faktureras fram till och med en dag (t.ex. månadsskiftet) */
export async function invoiceContract(actor: Actor, contractId: number, input: Record<string, unknown>) {
  const until = date(input, 'until', 'Fakturera till och med');
  return sql.begin(async (tx) => {
    const r = await invoiceTx(tx, actor, contractId, until);
    if (!r.invoiceId) throw new ConflictError('Det finns inget att fakturera för perioden');
    return r;
  });
}
