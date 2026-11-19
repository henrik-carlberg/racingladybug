import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { hasPermission } from '@/lib/permissions';
import { BANK_FIELDS, duplicateOf, isWeekend, unusualPayments, type BankField } from '@/lib/fraud';
import type { Actor } from './actor';

type Db = Tx | typeof sql;
export const KIND_LABEL: Record<string, string> = { bank_change: 'Ändrade bankuppgifter', duplicate: 'Möjlig dubblett', large: 'Ovanligt stort belopp', new_recipient: 'Ny mottagare', weekend: 'Bokfört på helgen' };

async function alert(db: Db, companyId: number, a: { kind: string; entity: string; entityId: number; title: string; detail: string }) {
  const r = await db`INSERT INTO risk_alerts (company_id, kind, entity, entity_id, title, detail) VALUES (${companyId}, ${a.kind}, ${a.entity}, ${a.entityId}, ${a.title}, ${a.detail})
    ON CONFLICT (company_id, kind, entity, entity_id) DO NOTHING RETURNING id`;
  return r.length > 0;
}

// ---------- Ändrade bankuppgifter ----------
/** Begär byte av bankuppgifter. Gäller först när en annan behörig person har godkänt. */
export async function requestBankChange(tx: Tx, actor: Actor, supplierId: number, name: string, old: Record<BankField, string>, next: Partial<Record<BankField, string>>) {
  const pending = await tx`SELECT 1 FROM supplier_bank_changes WHERE supplier_id = ${supplierId} AND status = 'pending'`;
  if (pending.length) throw new ConflictError('Ett byte av bankuppgifter väntar redan på godkännande för leverantören');
  const [c] = await tx<{ id: number }[]>`INSERT INTO supplier_bank_changes (company_id, supplier_id, old_values, new_values, requested_by)
    VALUES (${actor.companyId}, ${supplierId}, ${tx.json(old as never)}, ${tx.json(next as never)}, ${actor.userId}) RETURNING id`;
  await alert(tx, actor.companyId, { kind: 'bank_change', entity: 'supplier_bank_change', entityId: c.id, title: `${name} har fått nya bankuppgifter`,
    detail: Object.entries(next).map(([k, v]) => `${k}: ${old[k as BankField] || '–'} → ${v || '–'}`).join(', ') });
  await auditBy(tx, actor, 'bank_change_request', 'supplier', supplierId, { change: c.id, fields: Object.keys(next) });
  return c.id;
}

async function eligible(companyId: number) {
  return sql<{ user_id: number; role: string; permissions: string[] | null }[]>`SELECT user_id, role, permissions FROM memberships WHERE company_id = ${companyId} AND role IN ('owner','accountant')`
    .then((r) => r.filter((m) => hasPermission(m.role, m.permissions, 'attest')));
}

/** Godkänn eller avslå ett byte. Den som begärde bytet får inte godkänna det – utom när bolaget bara har en person med attesträtt och hen intygar kontroll med leverantören. */
export async function decideBankChange(actor: Actor, id: number, approve: boolean, comment: string, verified: boolean) {
  const who = await eligible(actor.companyId);
  if (!who.some((m) => m.user_id === actor.userId)) throw new ValidationError('Du saknar attesträtt och kan inte godkänna bankuppgifter');
  return sql.begin(async (tx) => {
    const [c] = await tx<{ supplier_id: number; new_values: Record<BankField, string>; status: string; requested_by: number | null }[]>`SELECT supplier_id, new_values, status, requested_by
      FROM supplier_bank_changes WHERE id = ${id} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!c) throw new NotFoundError('Ändringen');
    if (c.status !== 'pending') throw new ConflictError('Ändringen är redan hanterad');
    if (approve) {
      if (!comment.trim() && !verified) throw new ValidationError('Bekräfta att du har kontrollerat ändringen med leverantören');
      if (c.requested_by === actor.userId && who.length > 1) throw new ConflictError('En annan person än den som ändrade bankuppgifterna måste godkänna');
      if (c.requested_by === actor.userId && !verified) throw new ValidationError('Du är ensam med attesträtt: intyga att du har ringt leverantören på ett känt nummer och bekräftat de nya uppgifterna');
      const f = Object.fromEntries(Object.entries(c.new_values).filter(([k]) => (BANK_FIELDS as readonly string[]).includes(k)));
      if (Object.keys(f).length) await tx`UPDATE suppliers SET ${tx(f)} WHERE id = ${c.supplier_id} AND company_id = ${actor.companyId}`;
    }
    await tx`UPDATE supplier_bank_changes SET status = ${approve ? 'approved' : 'rejected'}, decided_by = ${actor.userId}, decided_at = now(), comment = ${comment.slice(0, 1000)} WHERE id = ${id}`;
    await tx`UPDATE risk_alerts SET status = ${approve ? 'ok' : 'confirmed'}, comment = ${comment.slice(0, 1000)}, resolved_by = ${actor.userId}, resolved_at = now()
      WHERE company_id = ${actor.companyId} AND kind = 'bank_change' AND entity = 'supplier_bank_change' AND entity_id = ${id}`;
    await auditBy(tx, actor, approve ? 'bank_change_approve' : 'bank_change_reject', 'supplier', c.supplier_id, { change: id });
  });
}

export async function pendingBankChanges(companyId: number) {
  return [...await sql<{ id: number; supplier_id: number; supplier: string; old_values: Record<string, string>; new_values: Record<string, string>; requested_by: number | null; by: string | null; at: string }[]>`
    SELECT c.id, c.supplier_id, s.name AS supplier, c.old_values, c.new_values, c.requested_by, u.name AS by, to_char(c.requested_at,'YYYY-MM-DD HH24:MI') AS at
    FROM supplier_bank_changes c JOIN suppliers s ON s.id = c.supplier_id LEFT JOIN users u ON u.id = c.requested_by
    WHERE c.company_id = ${companyId} AND c.status = 'pending' ORDER BY c.requested_at`];
}

// ---------- Dubbletter ----------
export async function checkDuplicate(tx: Tx, companyId: number, invoiceId: number) {
  const [n] = await tx<{ id: number; supplierId: number; number: string; date: string; total: number; reference: string; supplier: string }[]>`
    SELECT i.id, i.supplier_id AS "supplierId", i.invoice_number AS number, to_char(i.invoice_date,'YYYY-MM-DD') AS date, i.total::float8 AS total, i.payment_reference AS reference, s.name AS supplier
    FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id WHERE i.id = ${invoiceId}`;
  const earlier = await tx<{ id: number; supplierId: number; number: string; date: string; total: number; reference: string }[]>`
    SELECT id, supplier_id AS "supplierId", invoice_number AS number, to_char(invoice_date,'YYYY-MM-DD') AS date, total::float8 AS total, payment_reference AS reference
    FROM supplier_invoices WHERE company_id = ${companyId} AND id <> ${invoiceId} AND invoice_date > ${n.date}::date - 400 ORDER BY id DESC LIMIT 2000`;
  const d = duplicateOf(n, [...earlier]);
  if (!d) return null;
  await alert(tx, companyId, { kind: 'duplicate', entity: 'supplier_invoice', entityId: invoiceId, title: `Faktura ${n.number} från ${n.supplier} kan vara en dubblett`, detail: `Liknar leverantörsfaktura #${d.id}: ${d.reason}.` });
  return d;
}

/** Fakturor som inte får attesteras eller betalas: öppen dubblettvarning eller bankuppgifter som väntar på godkännande */
export async function blockedInvoices(db: Db, companyId: number, ids: number[], opts: { forPayment?: boolean } = { forPayment: true }) {
  if (!ids.length) return new Map<number, string>();
  const rows = await db<{ id: number; reason: string }[]>`SELECT i.id, CASE WHEN EXISTS (SELECT 1 FROM risk_alerts a WHERE a.company_id = ${companyId} AND a.kind = 'duplicate'
        AND a.entity = 'supplier_invoice' AND a.entity_id = i.id AND a.status <> 'ok') THEN 'kan vara en dubblett – granska varningen först'
      ELSE 'leverantörens nya bankuppgifter väntar på godkännande' END AS reason
    FROM supplier_invoices i WHERE i.company_id = ${companyId} AND i.id IN ${db(ids)} AND (
      EXISTS (SELECT 1 FROM risk_alerts a WHERE a.company_id = ${companyId} AND a.kind = 'duplicate' AND a.entity = 'supplier_invoice' AND a.entity_id = i.id AND a.status <> 'ok')
      OR (${opts.forPayment ?? true} AND EXISTS (SELECT 1 FROM supplier_bank_changes c WHERE c.supplier_id = i.supplier_id AND c.status = 'pending')))`;
  return new Map(rows.map((r) => [r.id, r.reason]));
}

// ---------- Ovanliga transaktioner ----------
export async function scanUnusual(companyId: number) {
  const outs = await sql<{ id: number; date: string; amount: number; counterparty: string }[]>`SELECT id, to_char(booking_date,'YYYY-MM-DD') AS date, amount::float8 AS amount,
      COALESCE(NULLIF(counterparty,''), description) AS counterparty FROM bank_transactions WHERE company_id = ${companyId} AND amount < 0 AND booking_date > current_date - 400 ORDER BY booking_date, id`;
  let n = 0;
  const recent = new Set(outs.filter((o) => o.date >= new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10)).map((o) => o.id));
  for (const u of unusualPayments([...outs])) {
    if (!recent.has(u.id)) continue;
    const o = outs.find((x) => x.id === u.id)!;
    if (await alert(sql, companyId, { kind: u.kind, entity: 'bank_transaction', entityId: u.id, title: `${(Math.abs(o.amount) / 100).toLocaleString('sv-SE')} kr till ${o.counterparty} ${o.date}`, detail: u.detail })) n++;
  }
  const manual = await sql<{ id: number; label: string; description: string; created_at: Date; amount: number }[]>`SELECT v.id, v.series || v.number AS label, v.description, v.created_at,
      (SELECT SUM(debit)::float8 FROM voucher_lines WHERE voucher_id = v.id) AS amount FROM vouchers v
    WHERE v.company_id = ${companyId} AND v.source_type IS NULL AND v.created_at > now() - interval '90 days'`;
  for (const v of manual) if (Number(v.amount) >= 1000000 && isWeekend(v.created_at) && await alert(sql, companyId, { kind: 'weekend', entity: 'voucher', entityId: v.id,
    title: `Verifikation ${v.label} bokfördes på en helg`, detail: `${v.description} · ${(Number(v.amount) / 100).toLocaleString('sv-SE')} kr` })) n++;
  return n;
}

export async function scanAll() {
  let n = 0;
  for (const c of await sql<{ id: number }[]>`SELECT DISTINCT company_id AS id FROM bank_transactions WHERE created_at > now() - interval '2 days'`) n += await scanUnusual(c.id).catch(() => 0);
  return n;
}

// ---------- Granskning ----------
export async function listAlerts(companyId: number, status: 'open' | 'closed') {
  return [...await sql<{ id: number; kind: string; entity: string; entity_id: number; title: string; detail: string; status: string; comment: string; created: string; by: string | null; resolved: string | null }[]>`
    SELECT a.id, a.kind, a.entity, a.entity_id, a.title, a.detail, a.status, a.comment, to_char(a.created_at,'YYYY-MM-DD') AS created, u.name AS by, to_char(a.resolved_at,'YYYY-MM-DD') AS resolved
    FROM risk_alerts a LEFT JOIN users u ON u.id = a.resolved_by WHERE a.company_id = ${companyId} AND ${status === 'open' ? sql`a.status = 'open'` : sql`a.status <> 'open'`}
    ORDER BY a.created_at DESC LIMIT 200`];
}

export async function resolveAlert(actor: Actor, id: number, status: 'ok' | 'confirmed', comment: string) {
  if (!comment.trim()) throw new ValidationError('Skriv en kommentar om vad du har kontrollerat');
  const r = await sql`UPDATE risk_alerts SET status = ${status}, comment = ${comment.slice(0, 1000)}, resolved_by = ${actor.userId}, resolved_at = now()
    WHERE id = ${id} AND company_id = ${actor.companyId} AND status = 'open' AND kind <> 'bank_change' RETURNING id`;
  if (!r.length) throw new NotFoundError('Varningen');
  await auditBy(sql, actor, 'alert_' + status, 'risk_alert', id);
}

export const openAlertCount = async (companyId: number) => Number((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM risk_alerts WHERE company_id = ${companyId} AND status = 'open'`)[0].n);
