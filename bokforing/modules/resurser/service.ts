import 'server-only';
import { randomUUID } from 'node:crypto';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { emit } from '@/lib/server/events';
import { addDays, today } from '@/lib/format';
import type { Actor } from '@/lib/services/actor';
import { date, int, optInt, str } from '@/lib/services/input';
import { saveDraftTx } from '@/lib/services/invoices';
import { monthRange } from '@/lib/time';
import { KINDS, bookingPrice, hoursBetween, utilization, weekly, withinOpenHours, workdaysInMonth } from './calc';

type Db = Tx | typeof sql;
const TZ = 'Europe/Stockholm';

// ---------- Resurser ----------

export interface ResourceOut {
  id: number; object: 'res.resource'; name: string; kind: string; kind_label: string; description: string; location: string; capacity: number | null;
  price_hour: number; price_day: number; vat_rate: number; open_from: string; open_to: string; requires_approval: boolean; active: boolean;
}

const RCOLS = (db: Db) => db`id, 'res.resource' AS object, name, kind, description, location, capacity, price_hour::bigint AS price_hour, price_day::bigint AS price_day, vat_rate,
  to_char(open_from, 'HH24:MI') AS open_from, to_char(open_to, 'HH24:MI') AS open_to, requires_approval, active`;
const rshape = (r: Omit<ResourceOut, 'kind_label'>): ResourceOut => ({ ...r, price_hour: Number(r.price_hour), price_day: Number(r.price_day), kind_label: KINDS[r.kind] ?? r.kind });

export async function listResources(companyId: number, f: { kind?: string; active?: boolean } = {}) {
  const rows = await sql<Omit<ResourceOut, 'kind_label'>[]>`SELECT ${RCOLS(sql)} FROM res_resources WHERE company_id = ${companyId}
    ${f.kind ? sql`AND kind = ${f.kind}` : sql``} ${f.active != null ? sql`AND active = ${f.active}` : sql``} ORDER BY active DESC, kind, name`;
  return rows.map(rshape);
}

export async function getResource(companyId: number, id: number, db: Db = sql) {
  const [r] = await db<Omit<ResourceOut, 'kind_label'>[]>`SELECT ${RCOLS(db)} FROM res_resources WHERE id = ${id} AND company_id = ${companyId}`;
  if (!r) throw new NotFoundError('Resursen');
  return rshape(r);
}

const time = (input: Record<string, unknown>, k: string, label: string, def: string) => {
  const v = str(input, k) || def;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new ValidationError(`${label}: ange tid som TT:MM`);
  return v;
};

export async function saveResource(actor: Actor, id: number | null, input: Record<string, unknown>): Promise<ResourceOut> {
  const kind = str(input, 'kind') || 'room';
  if (!KINDS[kind]) throw new ValidationError('Okänd typ av resurs');
  const vat = optInt(input, 'vat_rate', 'Moms') ?? 25;
  if (![0, 6, 12, 25].includes(vat)) throw new ValidationError('Momssats måste vara 0, 6, 12 eller 25');
  const nonneg = (k: string, l: string) => { const v = optInt(input, k, l) ?? 0; if (v < 0) throw new ValidationError(`${l} kan inte vara negativt`); return v; };
  const f = {
    name: str(input, 'name', { required: true, label: 'Namn' }), kind, description: str(input, 'description'), location: str(input, 'location'),
    capacity: optInt(input, 'capacity', 'Kapacitet'), price_hour: nonneg('price_hour', 'Timpris'), price_day: nonneg('price_day', 'Dagpris'), vat_rate: vat,
    open_from: time(input, 'open_from', 'Öppnar', '07:00'), open_to: time(input, 'open_to', 'Stänger', '18:00'),
    requires_approval: input.requires_approval === true || input.requires_approval === 'on' || input.requires_approval === 'true',
    active: input.active == null ? true : input.active === true || input.active === 'on' || input.active === 'true',
  };
  if (f.open_to <= f.open_from) throw new ValidationError('Stängningstiden måste vara efter öppningstiden');
  try {
    let rid = id ?? 0;
    if (id) {
      const r = await sql`UPDATE res_resources SET ${sql(f)} WHERE id = ${id} AND company_id = ${actor.companyId} RETURNING id`;
      if (!r.length) throw new NotFoundError('Resursen');
    } else {
      [{ id: rid }] = await sql<{ id: number }[]>`INSERT INTO res_resources ${sql({ ...f, company_id: actor.companyId })} RETURNING id`;
    }
    await auditBy(sql, actor, id ? 'update' : 'create', 'res.resource', rid);
    return getResource(actor.companyId, rid);
  } catch (e) {
    if (String((e as Error).message).includes('res_resources_company_id_name_key')) throw new ConflictError('Det finns redan en resurs med det namnet');
    throw e;
  }
}

// ---------- Bokningar ----------

export interface BookingOut {
  id: number; object: 'res.booking'; resource_id: number; resource: string; title: string; start: string; end: string; date: string; from: string; to: string;
  hours: number; status: 'pending' | 'confirmed' | 'cancelled'; booked_by: string; customer_id: number | null; customer: string | null; project_id: number | null; project: string | null;
  billable: boolean; invoice_id: number | null; series_id: string | null; notes: string; price: number;
}

const BCOLS = (db: Db) => db`b.id, 'res.booking' AS object, b.resource_id, r.name AS resource, b.title,
  to_char(b.starts_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD HH24:MI') AS start, to_char(b.ends_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD HH24:MI') AS "end",
  b.status, u.name AS booked_by, b.customer_id, c.name AS customer, b.project_id, p.name AS project, b.billable, b.invoice_id, b.series_id, b.notes,
  r.price_hour::bigint AS price_hour, r.price_day::bigint AS price_day`;
const BFROM = (db: Db) => db`res_bookings b JOIN res_resources r ON r.id = b.resource_id JOIN users u ON u.id = b.booked_by
  LEFT JOIN customers c ON c.id = b.customer_id LEFT JOIN projects p ON p.id = b.project_id`;
type BRow = Omit<BookingOut, 'date' | 'from' | 'to' | 'hours' | 'price'> & { price_hour: number; price_day: number };
const bshape = ({ price_hour, price_day, ...b }: BRow): BookingOut => ({
  ...b, date: b.start.slice(0, 10), from: b.start.slice(11), to: b.end.slice(0, 10) === b.start.slice(0, 10) ? b.end.slice(11) : b.end,
  hours: hoursBetween(b.start, b.end), price: b.billable ? bookingPrice(b.start, b.end, Number(price_hour), Number(price_day)).amount : 0,
});

export async function listBookings(companyId: number, f: { from?: string; to?: string; resource_id?: number; status?: string; customer_id?: number; uninvoiced?: boolean } = {}) {
  const rows = await sql<BRow[]>`SELECT ${BCOLS(sql)} FROM ${BFROM(sql)} WHERE b.company_id = ${companyId}
    ${f.from ? sql`AND b.ends_at > (${f.from}::date)::timestamp AT TIME ZONE ${TZ}` : sql``}
    ${f.to ? sql`AND b.starts_at < (${f.to}::date + 1)::timestamp AT TIME ZONE ${TZ}` : sql``}
    ${f.resource_id ? sql`AND b.resource_id = ${f.resource_id}` : sql``} ${f.status ? sql`AND b.status = ${f.status}` : sql`AND b.status <> 'cancelled'`}
    ${f.customer_id ? sql`AND b.customer_id = ${f.customer_id}` : sql``} ${f.uninvoiced ? sql`AND b.billable AND b.invoice_id IS NULL` : sql``}
    ORDER BY b.starts_at, r.name`;
  return rows.map(bshape);
}

export async function getBooking(companyId: number, id: number, db: Db = sql) {
  const [b] = await db<BRow[]>`SELECT ${BCOLS(db)} FROM ${BFROM(db)} WHERE b.id = ${id} AND b.company_id = ${companyId}`;
  if (!b) throw new NotFoundError('Bokningen');
  return bshape(b);
}

/** Krockande bokningar för en resurs (bekräftade och väntande) */
async function conflicts(db: Db, resourceId: number, start: string, end: string, exceptId?: number) {
  return db<{ id: number; title: string; start: string; end: string }[]>`SELECT id, title,
      to_char(starts_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD HH24:MI') AS start, to_char(ends_at AT TIME ZONE ${TZ}, 'HH24:MI') AS "end"
    FROM res_bookings WHERE resource_id = ${resourceId} AND status <> 'cancelled' ${exceptId ? db`AND id <> ${exceptId}` : db``}
      AND tstzrange(starts_at, ends_at) && tstzrange((${start}::timestamp AT TIME ZONE ${TZ}), (${end}::timestamp AT TIME ZONE ${TZ}))`;
}

/**
 * Bokar en resurs. Med repeat_weeks > 1 skapas en serie (samma tid varje vecka). Krockar stoppar hela serien.
 * Resurser som kräver godkännande blir "väntar" tills ägaren godkänner (ägarens egna bokningar godkänns direkt).
 */
export async function createBooking(actor: Actor, input: Record<string, unknown>): Promise<BookingOut[]> {
  const resourceId = int(input, 'resource_id', 'Resurs');
  const d = date(input, 'date', 'Datum');
  const endDate = date(input, 'end_date', 'Slutdatum', false) || d;
  const from = time(input, 'from', 'Från', '08:00'), to = time(input, 'to', 'Till', '09:00');
  const repeat = Math.min(52, Math.max(1, optInt(input, 'repeat_weeks', 'Antal veckor') ?? 1));
  if (`${endDate} ${to}` <= `${d} ${from}`) throw new ValidationError('Sluttiden måste vara efter starttiden');
  if (repeat > 1 && endDate !== d) throw new ValidationError('Återkommande bokningar måste börja och sluta samma dag');
  const customerId = optInt(input, 'customer_id', 'Kund'), projectId = optInt(input, 'project_id', 'Projekt');
  const billable = input.billable === true || input.billable === 'on' || input.billable === 'true';
  if (billable && !customerId) throw new ValidationError('Välj kund för en bokning som ska faktureras');
  return sql.begin(async (tx) => {
    const r = await getResource(actor.companyId, resourceId, tx);
    if (!r.active) throw new ValidationError('Resursen går inte att boka');
    await tx`SELECT id FROM res_resources WHERE id = ${resourceId} FOR UPDATE`; // en bokning i taget per resurs
    if (customerId && !(await tx`SELECT 1 FROM customers WHERE id = ${customerId} AND company_id = ${actor.companyId}`).length) throw new ValidationError('Kunden finns inte');
    if (projectId && !(await tx`SELECT 1 FROM projects WHERE id = ${projectId} AND company_id = ${actor.companyId}`).length) throw new ValidationError('Projektet finns inte');
    const series = repeat > 1 ? randomUUID() : null;
    const status = r.requires_approval && actor.role !== 'owner' ? 'pending' : 'confirmed';
    const ids: number[] = [];
    for (const day of weekly(d, repeat)) {
      const endDay = addDays(day, Math.round((Date.parse(endDate) - Date.parse(d)) / 86400000));
      const start = `${day} ${from}`, end = `${endDay} ${to}`;
      if (!withinOpenHours(start, end, r.open_from, r.open_to)) throw new ValidationError(`${r.name} kan bokas ${r.open_from}–${r.open_to}`);
      const c = await conflicts(tx, resourceId, start, end);
      if (c.length) throw new ConflictError(`${r.name} är redan bokad ${c.map((x) => `${x.start}–${x.end} (${x.title})`).join(', ')}`);
      const [{ id }] = await tx<{ id: number }[]>`INSERT INTO res_bookings (company_id, resource_id, title, starts_at, ends_at, status, booked_by, customer_id, project_id, billable, series_id, notes)
        VALUES (${actor.companyId}, ${resourceId}, ${str(input, 'title') || r.name}, (${start}::timestamp AT TIME ZONE ${TZ}), (${end}::timestamp AT TIME ZONE ${TZ}),
          ${status}, ${actor.userId}, ${customerId}, ${projectId}, ${billable}, ${series}, ${str(input, 'notes')}) RETURNING id`;
      ids.push(id);
    }
    await auditBy(tx, actor, 'book', 'res.resource', resourceId, { bookings: ids, status });
    const out = await Promise.all(ids.map((id) => getBooking(actor.companyId, id, tx)));
    await emit(tx, actor.companyId, 'resurser.booking.created', { bookings: out });
    return out;
  });
}

export async function setStatus(actor: Actor, id: number, status: 'confirmed' | 'cancelled', series = false) {
  if (status === 'confirmed' && actor.role !== 'owner') throw new ValidationError('Bara ägaren kan godkänna bokningar');
  return sql.begin(async (tx) => {
    const b = await getBooking(actor.companyId, id, tx);
    if (b.invoice_id) throw new ConflictError('Bokningen är fakturerad och kan inte ändras');
    const ids = series && b.series_id
      ? (await tx<{ id: number }[]>`SELECT id FROM res_bookings WHERE series_id = ${b.series_id} AND company_id = ${actor.companyId} AND invoice_id IS NULL
          AND starts_at >= (${b.start}::timestamp AT TIME ZONE ${TZ})`).map((r) => r.id)
      : [id];
    if (status === 'confirmed') {
      for (const bid of ids) {
        const x = await getBooking(actor.companyId, bid, tx);
        const [r0] = await tx<{ start: string; end: string }[]>`SELECT to_char(starts_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD HH24:MI') AS start, to_char(ends_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD HH24:MI') AS "end" FROM res_bookings WHERE id = ${bid}`;
        const c = (await conflicts(tx, x.resource_id, r0.start, r0.end, bid));
        if (c.length) throw new ConflictError(`Krockar med ${c[0].title} ${c[0].start}`);
      }
    }
    await tx`UPDATE res_bookings SET status = ${status} WHERE id IN ${tx(ids)}`;
    await auditBy(tx, actor, status === 'confirmed' ? 'approve' : 'cancel', 'res.booking', id, { count: ids.length });
    return ids.length;
  });
}

/** Lediga resurser för en tid */
export async function available(companyId: number, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum'), from = time(input, 'from', 'Från', '08:00'), to = time(input, 'to', 'Till', '09:00');
  if (to <= from) throw new ValidationError('Sluttiden måste vara efter starttiden');
  const kind = str(input, 'kind');
  const minCap = optInt(input, 'capacity', 'Antal personer');
  const out: (ResourceOut & { free: boolean; busy: string[] })[] = [];
  for (const r of await listResources(companyId, { kind: kind || undefined, active: true })) {
    if (minCap && (r.capacity ?? 0) < minCap) continue;
    const c = await conflicts(sql, r.id, `${d} ${from}`, `${d} ${to}`);
    const inside = withinOpenHours(`${d} ${from}`, `${d} ${to}`, r.open_from, r.open_to);
    out.push({ ...r, free: !c.length && inside, busy: inside ? c.map((x) => `${x.start.slice(11)}–${x.end} ${x.title}`) : [`Öppet ${r.open_from}–${r.open_to}`] });
  }
  return out.sort((a, b) => Number(b.free) - Number(a.free));
}

/** Fakturerbara, ej fakturerade bokningar för en kund → fakturautkast */
export async function invoiceBookings(actor: Actor, input: Record<string, unknown>) {
  const customerId = int(input, 'customer_id', 'Kund');
  const to = date(input, 'to', 'Till och med', false) || today();
  return sql.begin(async (tx) => {
    const list = (await listBookings(actor.companyId, { customer_id: customerId, to, uninvoiced: true, status: 'confirmed' })).filter((b) => b.end.slice(0, 10) <= to);
    if (!list.length) throw new ValidationError('Det finns inga bokningar att fakturera för kunden');
    const resources = new Map((await listResources(actor.companyId)).map((r) => [r.id, r]));
    const lines = list.map((b) => {
      const r = resources.get(b.resource_id)!;
      const p = bookingPrice(b.start, b.end, r.price_hour, r.price_day);
      return { description: `${b.resource} ${b.date} ${b.from}–${b.to}${b.title !== b.resource ? ` (${b.title})` : ''}`, quantity: p.qty, unit: p.unit, unit_price: p.unitPrice, vat_rate: r.vat_rate };
    }).filter((l) => l.unit_price > 0);
    if (!lines.length) throw new ValidationError('Resurserna saknar pris – ange timpris eller dagpris');
    const inv = await saveDraftTx(tx, actor, null, { customer_id: customerId, invoice_date: today(), notes: `Bokningar t.o.m. ${to}.`, lines });
    await tx`UPDATE res_bookings SET invoice_id = ${inv.id} WHERE id IN ${tx(list.map((b) => b.id))}`;
    await auditBy(tx, actor, 'invoice', 'res.booking', inv.id, { bookings: list.length });
    return inv;
  });
}

/** Beläggning per resurs och månad */
export async function utilizationReport(companyId: number, period: string) {
  const [from, to] = monthRange(period);
  const bookings = await listBookings(companyId, { from, to, status: 'confirmed' });
  const wd = workdaysInMonth(period);
  return (await listResources(companyId, { active: true })).map((r) => {
    const mine = bookings.filter((b) => b.resource_id === r.id);
    const hours = Math.round(mine.reduce((s, b) => s + b.hours, 0) * 10) / 10;
    return { ...r, bookings: mine.length, hours, utilization: utilization(hours, r.open_from, r.open_to, wd), revenue: mine.reduce((s, b) => s + b.price, 0) };
  });
}

/** Lyssnare: krediterad faktura → bokningarna blir ofakturerade igen */
export async function onInvoiceCredited(tx: Tx, companyId: number, originalInvoiceId: number) {
  await tx`UPDATE res_bookings SET invoice_id = NULL WHERE company_id = ${companyId} AND invoice_id = ${originalInvoiceId}`;
}
