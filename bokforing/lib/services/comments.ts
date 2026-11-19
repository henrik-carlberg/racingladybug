import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { findMentions } from '@/lib/mentions';
import type { Permission } from '@/lib/permissions';
import type { Actor } from './actor';
import { notify } from './push';

export type Entity = 'voucher' | 'invoice' | 'supplier_invoice' | 'bank_transaction';
export const ENTITY_PERM: Record<Entity, Permission> = { voucher: 'ledger', invoice: 'invoicing', supplier_invoice: 'purchasing', bank_transaction: 'ledger' };
export const isEntity = (e: string): e is Entity => e in ENTITY_PERM;

/** Länk och rubrik för det som kommenteras – och kontroll att det hör till bolaget */
export async function entityInfo(companyId: number, entity: Entity, id: number): Promise<{ title: string; href: string }> {
  const b = `/c/${companyId}`;
  const q = {
    voucher: sql<{ t: string }[]>`SELECT 'Verifikation ' || series || number || ' · ' || description AS t FROM vouchers WHERE id = ${id} AND company_id = ${companyId}`,
    invoice: sql<{ t: string }[]>`SELECT 'Kundfaktura ' || COALESCE(i.invoice_number::text, 'utkast') || ' · ' || c.name AS t FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ${id} AND i.company_id = ${companyId}`,
    supplier_invoice: sql<{ t: string }[]>`SELECT 'Leverantörsfaktura ' || si.invoice_number || ' · ' || s.name AS t FROM supplier_invoices si JOIN suppliers s ON s.id = si.supplier_id WHERE si.id = ${id} AND si.company_id = ${companyId}`,
    bank_transaction: sql<{ t: string }[]>`SELECT 'Banktransaktion ' || to_char(booking_date,'YYYY-MM-DD') || ' · ' || COALESCE(NULLIF(counterparty,''), description) || ' · ' || to_char(amount / 100.0, 'FM999G999G990D00') || ' kr' AS t FROM bank_transactions WHERE id = ${id} AND company_id = ${companyId}`,
  }[entity];
  const [r] = await q;
  if (!r) throw new NotFoundError('Posten');
  const href = { voucher: `${b}/verifikationer/${id}`, invoice: `${b}/fakturor/${id}`, supplier_invoice: `${b}/leverantorsfakturor/${id}`, bank_transaction: `${b}/bank/avstamning#t${id}` }[entity];
  return { title: r.t, href };
}

/** Personer som kan nämnas: bolagets medlemmar (inte anställda) och konsulter på byråer med åtkomst */
export async function mentionable(companyId: number): Promise<{ id: number; name: string }[]> {
  return [...await sql<{ id: number; name: string }[]>`
    SELECT DISTINCT u.id, u.name FROM users u WHERE u.id IN (
      SELECT user_id FROM memberships WHERE company_id = ${companyId} AND role <> 'employee'
      UNION SELECT fm.user_id FROM firm_members fm JOIN firm_clients fc ON fc.firm_id = fm.firm_id WHERE fc.company_id = ${companyId})
    ORDER BY u.name`];
}

/** Användare som får se poster med behörigheten: ägare, medlemmar utan begränsning eller med behörigheten, revisorer och byråns konsulter */
async function canSee(companyId: number, perm: Permission): Promise<Set<number>> {
  const rows = await sql<{ id: number }[]>`
    SELECT user_id AS id FROM memberships WHERE company_id = ${companyId} AND role <> 'employee'
      AND (role IN ('owner','auditor') OR permissions IS NULL OR ${perm} = ANY(permissions))
    UNION SELECT fm.user_id FROM firm_members fm JOIN firm_clients fc ON fc.firm_id = fm.firm_id WHERE fc.company_id = ${companyId}`;
  return new Set(rows.map((r) => r.id));
}

export async function addComment(actor: Actor & { userName: string }, entity: Entity, id: number, body: string) {
  const text = body.trim();
  if (!text) throw new ValidationError('Skriv en kommentar');
  if (text.length > 4000) throw new ValidationError('Kommentaren är för lång');
  const info = await entityInfo(actor.companyId, entity, id);
  const people = await mentionable(actor.companyId);
  // Bara de som får se posten kan nämnas (annars skulle notisen visa kommentaren för fel person)
  const allowed = await canSee(actor.companyId, ENTITY_PERM[entity]);
  const mentioned = findMentions(text, people).filter((u) => u !== actor.userId && allowed.has(u));
  const commentId = await sql.begin(async (tx) => {
    const [c] = await tx<{ id: number }[]>`INSERT INTO comments (company_id, entity, entity_id, user_id, body) VALUES (${actor.companyId}, ${entity}, ${id}, ${actor.userId}, ${text}) RETURNING id`;
    for (const u of mentioned) await tx`INSERT INTO comment_mentions (comment_id, user_id) VALUES (${c.id}, ${u})`;
    await auditBy(tx, actor, 'comment', entity, id, { comment: c.id });
    return c.id;
  });
  if (mentioned.length) notify.mention(actor.companyId, mentioned, actor.userName, text, info.href);
  return { id: commentId, mentioned };
}

export interface CommentOut { id: number; body: string; author: string | null; created_at: string; mine: boolean }
export async function listComments(companyId: number, entity: Entity, id: number, userId: number): Promise<CommentOut[]> {
  const rows = await sql<CommentOut[]>`
    SELECT c.id, c.body, u.name AS author, to_char(c.created_at AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD HH24:MI') AS created_at, c.user_id = ${userId} AS mine
    FROM comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.company_id = ${companyId} AND c.entity = ${entity} AND c.entity_id = ${id} ORDER BY c.id`;
  // Det man har nämnts i räknas som läst när tråden visas
  await sql`UPDATE comment_mentions m SET seen_at = now() FROM comments c WHERE c.id = m.comment_id AND m.user_id = ${userId} AND m.seen_at IS NULL AND c.company_id = ${companyId} AND c.entity = ${entity} AND c.entity_id = ${id}`;
  return [...rows];
}

export async function commentCounts(companyId: number, entity: Entity, ids: number[]): Promise<Record<number, number>> {
  if (!ids.length) return {};
  const rows = await sql<{ id: number; n: number }[]>`SELECT entity_id AS id, count(*)::int AS n FROM comments WHERE company_id = ${companyId} AND entity = ${entity} AND entity_id IN ${sql(ids)} GROUP BY entity_id`;
  return Object.fromEntries(rows.map((r) => [r.id, r.n]));
}

/** Senaste kommentarerna i bolaget som användaren får se; de där hen nämns först */
export async function recentComments(companyId: number, userId: number, can: (p: Permission) => boolean) {
  const allowed = (Object.keys(ENTITY_PERM) as Entity[]).filter((e) => can(ENTITY_PERM[e]));
  if (!allowed.length) return [];
  return [...await sql<{ id: number; entity: Entity; entity_id: number; body: string; author: string | null; created_at: string; mention: boolean; unseen: boolean }[]>`
    SELECT c.id, c.entity, c.entity_id, c.body, u.name AS author, to_char(c.created_at AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD HH24:MI') AS created_at,
      m.user_id IS NOT NULL AS mention, m.user_id IS NOT NULL AND m.seen_at IS NULL AS unseen
    FROM comments c LEFT JOIN users u ON u.id = c.user_id LEFT JOIN comment_mentions m ON m.comment_id = c.id AND m.user_id = ${userId}
    WHERE c.company_id = ${companyId} AND c.entity IN ${sql(allowed)} ORDER BY (m.user_id IS NOT NULL AND m.seen_at IS NULL) DESC, c.id DESC LIMIT 100`];
}

export async function unseenMentions(companyId: number, userId: number): Promise<number> {
  const [r] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM comment_mentions m JOIN comments c ON c.id = m.comment_id WHERE m.user_id = ${userId} AND m.seen_at IS NULL AND c.company_id = ${companyId}`;
  return r.n;
}
