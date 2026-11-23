import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { DEFERRED, VAT_OUT, eventResult, recognitionLines, refundLines, saleLines, seatsLeft, split } from '@/lib/events';
import type { Actor } from './actor';
import { date, int, optInt, str } from './input';
import { saveDraftTx } from './invoices';

const ensure = async (tx: Tx, companyId: number, vat: number) => {
  await tx`INSERT INTO accounts (company_id, number, name) VALUES (${companyId}, ${DEFERRED}, 'Förutbetalda intäkter') ON CONFLICT DO NOTHING`;
  if (vat) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${companyId}, ${VAT_OUT[vat]}, ${`Utgående moms ${vat} %`}) ON CONFLICT DO NOTHING`;
};

export async function overview(companyId: number) {
  const events = await sql<{ id: number; name: string; date: string; venue: string; budget_cost: number; status: string }[]>`SELECT id, name, to_char(date,'YYYY-MM-DD') AS date, venue, budget_cost::float8 AS budget_cost, status
    FROM company_events WHERE company_id = ${companyId} ORDER BY date DESC, id DESC LIMIT 100`;
  if (!events.length) return { events: [], customers: await customers(companyId), supplierInvoices: [] };
  const ids = sql(events.map((e) => e.id));
  const types = await sql<{ id: number; event_id: number; name: string; price: number; vat_rate: number; capacity: number | null; sold: number }[]>`SELECT t.id, t.event_id, t.name, t.price::float8 AS price, t.vat_rate, t.capacity,
      COALESCE((SELECT SUM(k.quantity) FROM event_tickets k WHERE k.type_id = t.id AND k.status = 'sold'), 0)::int AS sold FROM event_ticket_types t WHERE t.event_id IN ${ids} ORDER BY t.id`;
  const tickets = await sql<{ id: number; event_id: number; type: string; buyer: string; quantity: number; amount: number; status: string; vat_rate: number }[]>`SELECT k.id, k.event_id, t.name AS type, k.buyer, k.quantity, k.amount::float8 AS amount, k.status, t.vat_rate
    FROM event_tickets k JOIN event_ticket_types t ON t.id = k.type_id WHERE k.event_id IN ${ids} ORDER BY k.id DESC`;
  const sponsors = await sql<{ event_id: number; customer: string; amount: number; invoice_id: number | null }[]>`SELECT s.event_id, c.name AS customer, s.amount::float8 AS amount, s.invoice_id FROM event_sponsors s JOIN customers c ON c.id = s.customer_id WHERE s.event_id IN ${ids}`;
  const costs = await sql<{ event_id: number; number: string; supplier: string; net: number }[]>`SELECT ec.event_id, si.invoice_number AS number, su.name AS supplier, (si.total - si.vat)::float8 AS net FROM event_costs ec
    JOIN supplier_invoices si ON si.id = ec.supplier_invoice_id JOIN suppliers su ON su.id = si.supplier_id WHERE ec.event_id IN ${ids}`;
  const supplierInvoices = await sql<{ id: number; label: string }[]>`SELECT si.id, su.name || ' ' || si.invoice_number AS label FROM supplier_invoices si JOIN suppliers su ON su.id = si.supplier_id
    WHERE si.company_id = ${companyId} AND si.voucher_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM event_costs ec WHERE ec.supplier_invoice_id = si.id) ORDER BY si.invoice_date DESC LIMIT 200`;
  return {
    customers: await customers(companyId), supplierInvoices,
    events: events.map((e) => {
      const tk = tickets.filter((k) => k.event_id === e.id), sold = tk.filter((k) => k.status === 'sold');
      const ticketNet = sold.reduce((s, k) => s + split(k.amount, k.vat_rate).net, 0);
      const sp = sponsors.filter((s) => s.event_id === e.id), co = costs.filter((c) => c.event_id === e.id);
      return { ...e, types: types.filter((t) => t.event_id === e.id).map((t) => ({ ...t, left: seatsLeft(t.capacity, t.sold) })), tickets: tk, sponsors: sp, costItems: co,
        ...eventResult({ tickets: ticketNet, sponsors: sp.reduce((s, x) => s + x.amount, 0), costs: co.reduce((s, c) => s + c.net, 0), budget: e.budget_cost }) };
    }),
  };
}
const customers = (companyId: number) => sql<{ id: number; name: string }[]>`SELECT id, name FROM customers WHERE company_id = ${companyId} ORDER BY name LIMIT 500`;

export async function addEvent(actor: Actor, input: Record<string, unknown>) {
  const budget = String(input.budget_cost ?? '').trim() ? parseAmount(String(input.budget_cost)) : 0;
  if (budget == null || budget < 0) throw new ValidationError('Ogiltig kostnadsbudget');
  await sql`INSERT INTO company_events ${sql({ company_id: actor.companyId, name: str(input, 'name', { required: true, label: 'Evenemang', max: 200 }), date: date(input, 'date', 'Datum'), venue: str(input, 'venue', { max: 200 }), budget_cost: budget, created_by: actor.userId })}`;
}

const openEvent = async (db: Tx | typeof sql, actor: Actor, id: number, lock = false) => {
  const [e] = lock ? await db<{ name: string; date: string; status: string }[]>`SELECT name, to_char(date,'YYYY-MM-DD') AS date, status FROM company_events WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`
    : await db<{ name: string; date: string; status: string }[]>`SELECT name, to_char(date,'YYYY-MM-DD') AS date, status FROM company_events WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!e) throw new NotFoundError('Evenemanget');
  if (e.status !== 'open') throw new ConflictError('Evenemanget är redan genomfört eller inställt');
  return e;
};

export async function addTicketType(actor: Actor, eventId: number, input: Record<string, unknown>) {
  await openEvent(sql, actor, eventId);
  const price = parseAmount(String(input.price ?? '').trim());
  if (price == null || price <= 0) throw new ValidationError('Ange priset inkl. moms');
  const vat = Number(input.vat_rate ?? 25);
  if (![0, 6, 12, 25].includes(vat)) throw new ValidationError('Ogiltig momssats');
  const cap = optInt(input, 'capacity', 'Antal platser');
  if (cap != null && cap <= 0) throw new ValidationError('Antal platser ska vara minst ett');
  try { await sql`INSERT INTO event_ticket_types ${sql({ event_id: eventId, name: str(input, 'name', { required: true, label: 'Biljettyp', max: 100 }), price, vat_rate: vat, capacity: cap })}`; }
  catch (e) { if (String((e as Error).message).includes('event_ticket_types_event_id_name_key')) throw new ConflictError('Biljettypen finns redan'); throw e; }
}

/** Biljettförsäljning (betald): moms nu, resten förutbetald intäkt; aldrig fler än kapaciteten */
export async function sell(actor: Actor, eventId: number, input: Record<string, unknown>) {
  const typeId = int(input, 'type_id', 'Biljettyp'), q = int(input, 'quantity', 'Antal');
  if (q <= 0) throw new ValidationError('Ange antal biljetter');
  const d = date(input, 'date', 'Datum', false) || today();
  return sql.begin(async (tx) => {
    const e = await openEvent(tx, actor, eventId, true);
    const [t] = await tx<{ name: string; price: number; vat_rate: number; capacity: number | null }[]>`SELECT name, price::float8 AS price, vat_rate, capacity FROM event_ticket_types WHERE id = ${typeId} AND event_id = ${eventId}`;
    if (!t) throw new NotFoundError('Biljettypen');
    const [{ sold }] = await tx<{ sold: number }[]>`SELECT COALESCE(SUM(quantity), 0)::int AS sold FROM event_tickets WHERE type_id = ${typeId} AND status = 'sold'`;
    if (t.capacity != null && sold + q > t.capacity) throw new ValidationError(`Bara ${t.capacity - sold} platser kvar`);
    const amount = q * t.price;
    await ensure(tx, actor.companyId, t.vat_rate);
    const v = await createVoucher(tx, { actor, date: d, description: `Biljetter ${e.name}: ${q} × ${t.name}`, lines: fromSigned(saleLines(amount, t.vat_rate)), sourceType: 'event', sourceId: eventId });
    await tx`INSERT INTO event_tickets ${tx({ event_id: eventId, type_id: typeId, buyer: str(input, 'buyer', { required: true, label: 'Köpare', max: 200 }), quantity: q, amount, sold_on: d, voucher_id: v.id })}`;
    return amount;
  });
}

export async function refund(actor: Actor, ticketId: number) {
  return sql.begin(async (tx) => {
    const [k] = await tx<{ event_id: number; amount: number; status: string; vat_rate: number; buyer: string }[]>`SELECT k.event_id, k.amount::float8 AS amount, k.status, t.vat_rate, k.buyer FROM event_tickets k
      JOIN event_ticket_types t ON t.id = k.type_id JOIN company_events e ON e.id = k.event_id WHERE k.id = ${ticketId} AND e.company_id = ${actor.companyId} FOR UPDATE OF k`;
    if (!k) throw new NotFoundError('Biljetten');
    if (k.status !== 'sold') throw new ConflictError('Biljetten är redan återbetald');
    const e = await openEvent(tx, actor, k.event_id);
    const v = await createVoucher(tx, { actor, date: today(), description: `Återbetald biljett ${e.name}: ${k.buyer}`, lines: fromSigned(refundLines(k.amount, k.vat_rate)), sourceType: 'event', sourceId: k.event_id });
    await tx`UPDATE event_tickets SET status = 'refunded', refund_voucher_id = ${v.id} WHERE id = ${ticketId}`;
    return k.amount;
  });
}

/** Sponsring faktureras mot förutbetald intäkt och intäktsförs när eventet genomförs */
export async function addSponsor(actor: Actor, eventId: number, input: Record<string, unknown>) {
  const customerId = int(input, 'customer_id', 'Sponsor');
  const amount = parseAmount(String(input.amount ?? '').trim());
  if (amount == null || amount <= 0) throw new ValidationError('Ange sponsorbeloppet exkl. moms');
  return sql.begin(async (tx) => {
    const e = await openEvent(tx, actor, eventId, true);
    const [c] = await tx`SELECT 1 FROM customers WHERE id = ${customerId} AND company_id = ${actor.companyId}`;
    if (!c) throw new NotFoundError('Kunden');
    await ensure(tx, actor.companyId, 25);
    const inv = await saveDraftTx(tx, actor, null, { customer_id: customerId, invoice_date: today(), notes: `Sponsring av ${e.name} ${e.date}.`,
      lines: [{ description: `Sponsring ${e.name}`, quantity: 1, unit: 'st', unit_price: amount, vat_rate: 25, account: DEFERRED }] });
    await tx`INSERT INTO event_sponsors ${tx({ event_id: eventId, customer_id: customerId, amount, invoice_id: inv.id })}`;
    return inv.id;
  });
}

export async function linkCost(actor: Actor, eventId: number, input: Record<string, unknown>) {
  const siId = int(input, 'supplier_invoice_id', 'Leverantörsfaktura');
  const [e] = await sql`SELECT 1 FROM company_events WHERE id = ${eventId} AND company_id = ${actor.companyId}`;
  if (!e) throw new NotFoundError('Evenemanget');
  const [si] = await sql`SELECT 1 FROM supplier_invoices WHERE id = ${siId} AND company_id = ${actor.companyId}`;
  if (!si) throw new NotFoundError('Leverantörsfakturan');
  try { await sql`INSERT INTO event_costs (event_id, supplier_invoice_id) VALUES (${eventId}, ${siId})`; }
  catch (x) { if (String((x as Error).message).includes('event_costs_supplier_invoice_id_key')) throw new ConflictError('Fakturan är redan kopplad till ett evenemang'); throw x; }
}

/** Genomfört: biljetter och sponsring intäktsförs. Inställt: sålda biljetter återbetalas. */
export async function finish(actor: Actor, eventId: number, kind: 'held' | 'cancelled') {
  return sql.begin(async (tx) => {
    const e = await openEvent(tx, actor, eventId, true);
    const sold = await tx<{ id: number; amount: number; vat_rate: number; buyer: string }[]>`SELECT k.id, k.amount::float8 AS amount, t.vat_rate, k.buyer FROM event_tickets k JOIN event_ticket_types t ON t.id = k.type_id
      WHERE k.event_id = ${eventId} AND k.status = 'sold' FOR UPDATE OF k`;
    let amount = 0, voucherId: number | null = null;
    if (kind === 'held') {
      const [{ sponsor }] = await tx<{ sponsor: number }[]>`SELECT COALESCE(SUM(s.amount), 0)::float8 AS sponsor FROM event_sponsors s JOIN invoices i ON i.id = s.invoice_id WHERE s.event_id = ${eventId} AND i.status <> 'draft'`;
      const lines = recognitionLines(sold.map((k) => ({ net: split(k.amount, k.vat_rate).net, vat_rate: k.vat_rate })), sponsor);
      if (lines.length) {
        for (const l of lines) if (l.account !== DEFERRED) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${l.account}, 'Försäljning') ON CONFLICT DO NOTHING`;
        voucherId = (await createVoucher(tx, { actor, date: e.date > today() ? today() : e.date, description: `Genomfört evenemang ${e.name}: förutbetalda intäkter intäktsförs`, lines: fromSigned(lines), sourceType: 'event', sourceId: eventId })).id;
        amount = lines[0].amount;
      }
    } else {
      for (const k of sold) {
        const v = await createVoucher(tx, { actor, date: today(), description: `Inställt ${e.name}: återbetald biljett ${k.buyer}`, lines: fromSigned(refundLines(k.amount, k.vat_rate)), sourceType: 'event', sourceId: eventId });
        await tx`UPDATE event_tickets SET status = 'refunded', refund_voucher_id = ${v.id} WHERE id = ${k.id}`;
        amount += k.amount;
      }
    }
    await tx`UPDATE company_events SET status = ${kind}, recognized_voucher_id = ${voucherId} WHERE id = ${eventId}`;
    await auditBy(tx, actor, `event_${kind}`, 'event', eventId, { amount });
    return amount;
  });
}
