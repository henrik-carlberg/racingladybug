import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { emit } from '@/lib/server/events';
import type { Actor } from '@/lib/services/actor';
import { date, int, optInt, str } from '@/lib/services/input';
import { saveDraftTx } from '@/lib/services/invoices';

export const STATUS: Record<string, string> = { new: 'Ny', scheduled: 'Planerad', in_progress: 'Pågår', done: 'Klar', invoiced: 'Fakturerad', cancelled: 'Makulerad' };
export const KIND: Record<string, string> = { labor: 'Arbete', material: 'Material', other: 'Övrigt' };

export interface Item { id: number; kind: string; description: string; quantity: number; unit: string; unit_price: number; vat_rate: number; user_name: string | null; date: string }
export interface Order {
  id: number; number: number; customer_id: number; customer: string; title: string; description: string; address: string; scheduled_date: string | null;
  assignee_user_id: number | null; assignee: string | null; project_id: number | null; status: string; report: string; signed_by: string; signed_at: string | null;
  invoice_id: number | null; invoice_number: number | null; items: Item[]; net: number;
}

export const itemNet = (i: Pick<Item, 'quantity' | 'unit_price'>) => Math.round(Number(i.quantity) * Number(i.unit_price));

export async function listOrders(companyId: number, f: { status?: string; assignee?: number } = {}) {
  return sql<{ id: number; number: number; title: string; customer: string; status: string; scheduled_date: string | null; assignee: string | null; net: number }[]>`
    SELECT o.id, o.number, o.title, c.name AS customer, o.status, to_char(o.scheduled_date,'YYYY-MM-DD') AS scheduled_date, u.name AS assignee,
      COALESCE((SELECT SUM(round(i.quantity * i.unit_price)) FROM wo_items i WHERE i.order_id = o.id), 0)::bigint AS net
    FROM wo_orders o JOIN customers c ON c.id = o.customer_id LEFT JOIN users u ON u.id = o.assignee_user_id
    WHERE o.company_id = ${companyId}
      ${f.status === 'open' ? sql`AND o.status IN ('new','scheduled','in_progress','done')` : f.status ? sql`AND o.status = ${f.status}` : sql``}
      ${f.assignee ? sql`AND o.assignee_user_id = ${f.assignee}` : sql``}
    ORDER BY CASE o.status WHEN 'in_progress' THEN 0 WHEN 'scheduled' THEN 1 WHEN 'new' THEN 2 WHEN 'done' THEN 3 ELSE 4 END, o.scheduled_date NULLS LAST, o.number DESC LIMIT 500`;
}

export async function getOrder(companyId: number, id: number): Promise<Order> {
  const [o] = await sql<Omit<Order, 'items' | 'net'>[]>`
    SELECT o.id, o.number, o.customer_id, c.name AS customer, o.title, o.description, o.address, to_char(o.scheduled_date,'YYYY-MM-DD') AS scheduled_date,
      o.assignee_user_id, u.name AS assignee, o.project_id, o.status, o.report, o.signed_by, to_char(o.signed_at AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD HH24:MI') AS signed_at,
      o.invoice_id, inv.invoice_number
    FROM wo_orders o JOIN customers c ON c.id = o.customer_id LEFT JOIN users u ON u.id = o.assignee_user_id LEFT JOIN invoices inv ON inv.id = o.invoice_id
    WHERE o.id = ${id} AND o.company_id = ${companyId}`;
  if (!o) throw new NotFoundError('Arbetsordern');
  const items = await sql<Item[]>`SELECT i.id, i.kind, i.description, i.quantity::float8 AS quantity, i.unit, i.unit_price::bigint AS unit_price, i.vat_rate, u.name AS user_name, to_char(i.date,'YYYY-MM-DD') AS date
    FROM wo_items i LEFT JOIN users u ON u.id = i.user_id WHERE i.order_id = ${id} ORDER BY i.kind, i.id`;
  const list = items.map((i) => ({ ...i, unit_price: Number(i.unit_price) }));
  return { ...o, items: list, net: list.reduce((s, i) => s + itemNet(i), 0) };
}

async function assertMember(companyId: number, userId: number | null) {
  if (!userId) return;
  const [m] = await sql`SELECT 1 FROM memberships WHERE company_id = ${companyId} AND user_id = ${userId}`;
  if (!m) throw new ValidationError('Personen är inte användare i bolaget');
}

export async function createOrder(actor: Actor, input: Record<string, unknown>) {
  const customerId = int(input, 'customer_id', 'Kund');
  const [c] = await sql`SELECT 1 FROM customers WHERE id = ${customerId} AND company_id = ${actor.companyId}`;
  if (!c) throw new ValidationError('Kunden finns inte');
  const assignee = optInt(input, 'assignee_user_id', 'Ansvarig');
  await assertMember(actor.companyId, assignee);
  const scheduled = date(input, 'scheduled_date', 'Datum', false) || null;
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${actor.companyId}, 7301)`;
    const [{ n }] = await tx<{ n: number }[]>`SELECT COALESCE(max(number), 0) + 1 AS n FROM wo_orders WHERE company_id = ${actor.companyId}`;
    const [r] = await tx<{ id: number }[]>`INSERT INTO wo_orders ${tx({
      company_id: actor.companyId, number: n, customer_id: customerId, title: str(input, 'title', { required: true, label: 'Rubrik' }),
      description: str(input, 'description'), address: str(input, 'address'), scheduled_date: scheduled, assignee_user_id: assignee,
      status: scheduled ? 'scheduled' : 'new', created_by: actor.userId,
    })} RETURNING id`;
    await auditBy(tx, actor, 'create', 'work_order', r.id, { number: n });
    await emit(tx, actor.companyId, 'arbetsorder.created', { id: r.id, object: 'work_order', number: n });
    return r.id;
  });
}

async function editable(actor: Actor, id: number) {
  const [o] = await sql<{ status: string; invoice_id: number | null }[]>`SELECT status, invoice_id FROM wo_orders WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!o) throw new NotFoundError('Arbetsordern');
  // Togs fakturautkastet bort blir ordern klar igen
  if (o.status === 'invoiced' && !o.invoice_id) { await sql`UPDATE wo_orders SET status = 'done' WHERE id = ${id}`; o.status = 'done'; }
  if (o.status === 'invoiced' || o.status === 'cancelled') throw new ConflictError('Arbetsordern är fakturerad eller makulerad och kan inte ändras');
  return o;
}

export async function addItem(actor: Actor, id: number, input: Record<string, unknown>) {
  await editable(actor, id);
  const kind = str(input, 'kind') || 'labor';
  if (!KIND[kind]) throw new ValidationError('Ogiltig typ');
  const quantity = Number(String(input.quantity ?? '').replace(',', '.'));
  if (!Number.isFinite(quantity) || quantity <= 0) throw new ValidationError('Ange antal');
  const vat = optInt(input, 'vat_rate', 'Moms') ?? 25;
  if (![0, 6, 12, 25].includes(vat)) throw new ValidationError('Moms 0, 6, 12 eller 25 %');
  const price = int(input, 'unit_price', 'À-pris');
  if (price < 0) throw new ValidationError('Ogiltigt pris');
  await sql`INSERT INTO wo_items ${sql({
    order_id: id, kind, description: str(input, 'description', { required: true, label: 'Beskrivning' }), quantity, unit: str(input, 'unit') || (kind === 'labor' ? 'h' : 'st'),
    unit_price: price, vat_rate: vat, user_id: actor.userId, date: date(input, 'date', 'Datum', false) || new Date().toISOString().slice(0, 10),
  })}`;
  await sql`UPDATE wo_orders SET status = 'in_progress' WHERE id = ${id} AND status IN ('new','scheduled')`;
}

export async function removeItem(actor: Actor, id: number, itemId: number) {
  await editable(actor, id);
  await sql`DELETE FROM wo_items WHERE id = ${itemId} AND order_id = ${id}`;
}

export async function update(actor: Actor, id: number, input: Record<string, unknown>) {
  await editable(actor, id);
  const assignee = optInt(input, 'assignee_user_id', 'Ansvarig');
  await assertMember(actor.companyId, assignee);
  const status = str(input, 'status');
  if (status && (!STATUS[status] || status === 'invoiced')) throw new ValidationError('Ogiltig status');
  await sql`UPDATE wo_orders SET title = ${str(input, 'title', { required: true, label: 'Rubrik' })}, description = ${str(input, 'description')}, address = ${str(input, 'address')},
    scheduled_date = ${date(input, 'scheduled_date', 'Datum', false) || null}, assignee_user_id = ${assignee}, report = ${str(input, 'report')},
    status = COALESCE(${status || null}, status), done_at = CASE WHEN ${status} = 'done' THEN COALESCE(done_at, now()) ELSE done_at END
    WHERE id = ${id}`;
  await auditBy(sql, actor, 'update', 'work_order', id, { status: status || undefined });
}

/** Kunden godkänner utfört arbete på plats (namnförtydligande) – ordern markeras som klar */
export async function sign(actor: Actor, id: number, name: string) {
  await editable(actor, id);
  if (name.trim().length < 2) throw new ValidationError('Ange kundens namn');
  await sql`UPDATE wo_orders SET signed_by = ${name.trim()}, signed_at = now(), status = 'done', done_at = COALESCE(done_at, now()) WHERE id = ${id}`;
  await auditBy(sql, actor, 'sign', 'work_order', id, { name: name.trim() });
}

/** Skapar ett fakturautkast av arbetsorderns rader. Arbete markeras som arbetskostnad (grund för ROT/RUT). */
export async function invoiceOrder(actor: Actor, id: number) {
  const o = await getOrder(actor.companyId, id);
  if (o.invoice_id) throw new ConflictError('Arbetsordern är redan fakturerad');
  if (o.status === 'cancelled') throw new ConflictError('Arbetsordern är makulerad');
  if (!o.items.length) throw new ValidationError('Arbetsordern har inga rader att fakturera');
  return sql.begin(async (tx) => {
    const inv = await saveDraftTx(tx, actor, null, {
      customer_id: o.customer_id, invoice_date: new Date().toISOString().slice(0, 10), your_reference: '',
      our_reference: o.assignee ?? '', notes: `Arbetsorder ${o.number}: ${o.title}${o.address ? `, ${o.address}` : ''}${o.report ? `\n${o.report}` : ''}`,
      lines: o.items.map((i) => ({ description: `${i.description}${i.date ? ` (${i.date})` : ''}`, quantity: i.quantity, unit: i.unit, unit_price: i.unit_price, vat_rate: i.vat_rate, labor: i.kind === 'labor' })),
    });
    if (o.project_id) await tx`UPDATE invoices SET project_id = ${o.project_id} WHERE id = ${inv.id}`;
    await tx`UPDATE wo_orders SET status = 'invoiced', invoice_id = ${inv.id} WHERE id = ${id}`;
    await auditBy(tx, actor, 'invoice', 'work_order', id, { invoice_id: inv.id });
    await emit(tx, actor.companyId, 'arbetsorder.invoiced', { id, object: 'work_order', number: o.number, invoice_id: inv.id });
    return inv.id;
  });
}
