import 'server-only';
import { randomBytes } from 'node:crypto';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { parseAmount } from '@/lib/money';
import { today } from '@/lib/format';
import { ADVANCE, VAT_OUT, doneLines, fmt, freeSlots, keepAndRefundLines, keepOnCancel, overlaps, prepayLines, salesAccount, toMin, weekday } from '@/lib/bookings';
import type { Actor } from './actor';
import { date, int, str } from './input';

type Db = Tx | typeof sql;
interface Settings { token: string; open_from: number; open_to: number; weekdays: string; cancel_hours: number; no_show_pct: number; active: boolean }
const settingsOf = async (db: Db, companyId: number) => (await db<Settings[]>`SELECT token, open_from, open_to, weekdays, cancel_hours, no_show_pct, active FROM booking_settings WHERE company_id = ${companyId}`)[0] ?? null;

async function dayBookings(db: Db, companyId: number, d: string) {
  return db<{ start: number; end: number }[]>`SELECT start_min AS start, end_min AS end FROM bookings WHERE company_id = ${companyId} AND date = ${d} AND status <> 'cancelled'`;
}

export async function overview(companyId: number, d: string) {
  const settings = await settingsOf(sql, companyId);
  const services = await sql<{ id: number; name: string; minutes: number; price: number; vat_rate: number; prepay: boolean }[]>`SELECT id, name, minutes, price::float8 AS price, vat_rate, prepay FROM booking_services WHERE company_id = ${companyId} AND active ORDER BY name`;
  const bookings = await sql<{ id: number; service: string; date: string; start_min: number; end_min: number; customer_name: string; customer_email: string; status: string; price: number; prepaid: boolean; source: string; kept: number | null }[]>`
    SELECT b.id, s.name AS service, to_char(b.date,'YYYY-MM-DD') AS date, b.start_min, b.end_min, b.customer_name, b.customer_email, b.status, b.price::float8 AS price, b.prepaid, b.source, b.kept::float8 AS kept
    FROM bookings b JOIN booking_services s ON s.id = b.service_id WHERE b.company_id = ${companyId} AND b.date >= ${d}::date - 30 ORDER BY b.date, b.start_min LIMIT 300`;
  const stats = await sql<{ service: string; done: number; no_show: number; revenue: number }[]>`SELECT s.name AS service, count(*) FILTER (WHERE b.status = 'done')::int AS done, count(*) FILTER (WHERE b.status = 'no_show')::int AS no_show,
      COALESCE(SUM(CASE WHEN b.status = 'done' THEN b.price WHEN b.status IN ('no_show','cancelled') THEN COALESCE(b.kept, 0) ELSE 0 END), 0)::float8 AS revenue
    FROM booking_services s LEFT JOIN bookings b ON b.service_id = s.id AND b.date > ${d}::date - 90 WHERE s.company_id = ${companyId} GROUP BY s.name ORDER BY s.name`;
  const [{ advance }] = await sql<{ advance: number }[]>`SELECT COALESCE(SUM(l.credit - l.debit), 0)::float8 AS advance FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id WHERE v.company_id = ${companyId} AND l.account_number = ${ADVANCE} AND v.source_type = 'booking'`;
  return { settings, services, bookings: bookings.map((b) => ({ ...b, time: `${fmt(b.start_min)}–${fmt(b.end_min)}` })), stats, advance };
}

export async function saveSettings(actor: Actor, input: Record<string, unknown>) {
  const from = toMin(str(input, 'open_from') || '09:00'), to = toMin(str(input, 'open_to') || '17:00');
  if (from == null || to == null || to <= from) throw new ValidationError('Ange öppettider som TT:MM, där stängning är efter öppning');
  const days = String(input.weekdays ?? '1,2,3,4,5').split(',').map((x) => Number(x.trim())).filter((x) => x >= 1 && x <= 7);
  if (!days.length) throw new ValidationError('Ange minst en veckodag (1 = måndag)');
  const cancel = Number(input.cancel_hours ?? 24), pct = Number(input.no_show_pct ?? 100);
  if (!Number.isInteger(cancel) || cancel < 0 || !Number.isInteger(pct) || pct < 0 || pct > 100) throw new ValidationError('Ogiltiga avbokningsregler');
  await sql`INSERT INTO booking_settings (company_id, token, open_from, open_to, weekdays, cancel_hours, no_show_pct) VALUES (${actor.companyId}, ${randomBytes(18).toString('base64url')}, ${from}, ${to}, ${days.join(',')}, ${cancel}, ${pct})
    ON CONFLICT (company_id) DO UPDATE SET open_from = EXCLUDED.open_from, open_to = EXCLUDED.open_to, weekdays = EXCLUDED.weekdays, cancel_hours = EXCLUDED.cancel_hours, no_show_pct = EXCLUDED.no_show_pct`;
}

export async function addService(actor: Actor, input: Record<string, unknown>) {
  const minutes = int(input, 'minutes', 'Längd (minuter)');
  if (minutes < 5 || minutes > 720) throw new ValidationError('Längden ska vara 5–720 minuter');
  const price = parseAmount(String(input.price ?? '').trim() || '0');
  if (price == null || price < 0) throw new ValidationError('Ange priset inkl. moms');
  const vat = Number(input.vat_rate ?? 25);
  if (![0, 6, 12, 25].includes(vat)) throw new ValidationError('Ogiltig momssats');
  try {
    await sql`INSERT INTO booking_services ${sql({ company_id: actor.companyId, name: str(input, 'name', { required: true, label: 'Tjänst', max: 100 }), minutes, price, vat_rate: vat, prepay: input.prepay === 'on' })}`;
  } catch (e) { if (String((e as Error).message).includes('booking_services_company_id_name_key')) throw new ConflictError('Tjänsten finns redan'); throw e; }
}

/** En bokning – från personalen eller via den publika länken – krockar aldrig med en annan och ligger inom öppettiderna */
async function createTx(tx: Tx, companyId: number, input: Record<string, unknown>, source: 'online' | 'staff') {
  const s = await settingsOf(tx, companyId);
  if (!s) throw new ValidationError('Ställ in öppettider först');
  const serviceId = int(input, 'service_id', 'Tjänst');
  const [svc] = await tx<{ minutes: number; price: number; vat_rate: number; name: string }[]>`SELECT minutes, price::float8 AS price, vat_rate, name FROM booking_services WHERE id = ${serviceId} AND company_id = ${companyId} AND active`;
  if (!svc) throw new NotFoundError('Tjänsten');
  const d = date(input, 'date', 'Datum');
  const start = toMin(str(input, 'time', { required: true, label: 'Tid' }));
  if (start == null) throw new ValidationError('Ange tiden som TT:MM');
  if (source === 'online' && d < today()) throw new ValidationError('Välj en dag från och med i dag');
  if (!s.weekdays.split(',').map(Number).includes(weekday(d))) throw new ValidationError('Det går inte att boka den veckodagen');
  const end = start + svc.minutes;
  if (start < s.open_from || end > s.open_to) throw new ValidationError(`Bokningen ska rymmas inom öppettiderna ${fmt(s.open_from)}–${fmt(s.open_to)}`);
  await tx`SELECT company_id FROM booking_settings WHERE company_id = ${companyId} FOR UPDATE`;
  if ((await dayBookings(tx, companyId, d)).some((b) => overlaps({ start, end }, b))) throw new ConflictError('Tiden är redan bokad');
  const name = str(input, 'customer_name', { required: true, label: 'Namn', max: 200 });
  const [b] = await tx<{ id: number }[]>`INSERT INTO bookings ${tx({ company_id: companyId, service_id: serviceId, date: d, start_min: start, end_min: end, customer_name: name, customer_email: str(input, 'customer_email', { max: 200 }),
    customer_phone: str(input, 'customer_phone', { max: 40 }), price: svc.price, vat_rate: svc.vat_rate, source })} RETURNING id`;
  return { id: b.id, service: svc.name, date: d, time: fmt(start), prepay: false };
}

export async function book(actor: Actor, input: Record<string, unknown>) {
  return sql.begin(async (tx) => { const r = await createTx(tx, actor.companyId, input, 'staff'); await auditBy(tx, actor, 'booking', 'booking', r.id); return r; });
}

// ---------- Publik bokning (ingen inloggning – adressen är hemlig) ----------
export async function publicInfo(token: string, d: string) {
  const [s] = await sql<(Settings & { company_id: number; company: string })[]>`SELECT b.*, c.name AS company FROM booking_settings b JOIN companies c ON c.id = b.company_id WHERE b.token = ${token} AND b.active`;
  if (!s) return null;
  const services = await sql<{ id: number; name: string; minutes: number; price: number; prepay: boolean }[]>`SELECT id, name, minutes, price::float8 AS price, prepay FROM booking_services WHERE company_id = ${s.company_id} AND active ORDER BY name`;
  const open = s.weekdays.split(',').map(Number).includes(weekday(d));
  const booked = open ? await dayBookings(sql, s.company_id, d) : [];
  return { company: s.company, open, from: s.open_from, to: s.open_to, cancelHours: s.cancel_hours,
    services: services.map((x) => ({ ...x, slots: open && d >= today() ? freeSlots({ from: s.open_from, to: s.open_to, minutes: x.minutes, booked }).map(fmt) : [] })) };
}
export async function publicBook(token: string, input: Record<string, unknown>) {
  const [s] = await sql<{ company_id: number }[]>`SELECT company_id FROM booking_settings WHERE token = ${token} AND active`;
  if (!s) throw new NotFoundError('Bokningssidan');
  return sql.begin((tx) => createTx(tx, s.company_id, input, 'online'));
}

const lock = async (tx: Tx, actor: Actor, id: number) => {
  const [b] = await tx<{ status: string; price: number; vat_rate: number; prepaid: boolean; date: string; start_min: number; customer_name: string; service: string }[]>`
    SELECT b.status, b.price::float8 AS price, b.vat_rate, b.prepaid, to_char(b.date,'YYYY-MM-DD') AS date, b.start_min, b.customer_name, s.name AS service
    FROM bookings b JOIN booking_services s ON s.id = b.service_id WHERE b.id = ${id} AND b.company_id = ${actor.companyId} FOR UPDATE OF b`;
  if (!b) throw new NotFoundError('Bokningen');
  return b;
};
const ensure = async (tx: Tx, companyId: number, vat: number) => {
  await tx`INSERT INTO accounts (company_id, number, name) VALUES (${companyId}, ${ADVANCE}, 'Förskott från kunder') ON CONFLICT DO NOTHING`;
  if (vat) await tx`INSERT INTO accounts (company_id, number, name) VALUES (${companyId}, ${VAT_OUT[vat]}, ${`Utgående moms ${vat} %`}) ON CONFLICT DO NOTHING`;
  await tx`INSERT INTO accounts (company_id, number, name) VALUES (${companyId}, ${salesAccount(vat)}, 'Försäljning av tjänster') ON CONFLICT DO NOTHING`;
};

/** Förskott mottaget (t.ex. Swish eller kort): momsen redovisas nu, resten är förutbetald intäkt */
export async function prepay(actor: Actor, id: number, input: Record<string, unknown>) {
  const d = date(input, 'date', 'Datum', false) || today();
  return sql.begin(async (tx) => {
    const b = await lock(tx, actor, id);
    if (b.status !== 'booked') throw new ConflictError('Bokningen är inte öppen för förskott');
    if (!b.price) throw new ValidationError('Tjänsten är gratis');
    await ensure(tx, actor.companyId, b.vat_rate);
    const v = await createVoucher(tx, { actor, date: d, description: `Förskott bokning ${b.date} ${fmt(b.start_min)}: ${b.service}, ${b.customer_name}`, lines: fromSigned(prepayLines(b.price, b.vat_rate)), sourceType: 'booking', sourceId: id });
    await tx`UPDATE bookings SET status = 'prepaid', prepaid = true, prepay_voucher_id = ${v.id} WHERE id = ${id}`;
    return b.price;
  });
}

/** Tjänsten är utförd: förskottet blir intäkt, eller så betalas den på plats */
export async function done(actor: Actor, id: number) {
  return sql.begin(async (tx) => {
    const b = await lock(tx, actor, id);
    if (!['booked', 'prepaid'].includes(b.status)) throw new ConflictError('Bokningen är redan avslutad');
    let voucherId: number | null = null;
    if (b.price) {
      await ensure(tx, actor.companyId, b.vat_rate);
      voucherId = (await createVoucher(tx, { actor, date: b.date > today() ? today() : b.date, description: `Utförd tjänst ${b.date}: ${b.service}, ${b.customer_name}${b.prepaid ? ' (förskott)' : ''}`, lines: fromSigned(doneLines(b.price, b.vat_rate, b.prepaid)), sourceType: 'booking', sourceId: id })).id;
    }
    await tx`UPDATE bookings SET status = 'done', close_voucher_id = ${voucherId} WHERE id = ${id}`;
    return b.price;
  });
}

/** Avbokning eller uteblivet besök: vid sen avbokning och uteblivet besök behålls avgiften av förskottet, resten betalas tillbaka */
export async function close(actor: Actor, id: number, kind: 'cancelled' | 'no_show', now = new Date()) {
  return sql.begin(async (tx) => {
    const b = await lock(tx, actor, id);
    if (!['booked', 'prepaid'].includes(b.status)) throw new ConflictError('Bokningen är redan avslutad');
    const s = (await settingsOf(tx, actor.companyId))!;
    // Svensk tid: förskjutningen mot UTC är en timme på vintern och två på sommaren
    const offset = Number(new Date(`${b.date}T12:00:00Z`).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit' })) - 12;
    const startsAt = Date.parse(`${b.date}T${fmt(b.start_min)}:00Z`) - offset * 36e5;
    const hoursBefore = kind === 'no_show' ? 0 : (startsAt - now.getTime()) / 36e5;
    const keep = b.prepaid ? keepOnCancel({ price: b.price, hoursBefore, cancelHours: s.cancel_hours, noShowPct: s.no_show_pct }) : 0;
    let voucherId: number | null = null;
    if (b.prepaid) {
      await ensure(tx, actor.companyId, b.vat_rate);
      voucherId = (await createVoucher(tx, { actor, date: today(), description: `${kind === 'no_show' ? 'Uteblivet besök' : 'Avbokning'} ${b.date}: ${b.service}, ${b.customer_name}`, lines: fromSigned(keepAndRefundLines(b.price, b.vat_rate, keep)), sourceType: 'booking', sourceId: id })).id;
    }
    await tx`UPDATE bookings SET status = ${kind}, kept = ${keep}, close_voucher_id = ${voucherId} WHERE id = ${id}`;
    return { kept: keep, refunded: b.prepaid ? b.price - keep : 0 };
  });
}
