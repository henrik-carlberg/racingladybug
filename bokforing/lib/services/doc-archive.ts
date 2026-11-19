import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { fiscalYears } from '@/lib/server/ledger';
import { normalizeTag, retentionUntil } from '@/lib/doc-text';
import type { Actor } from './actor';

export interface Doc { id: number; filename: string; mime_type: string; size: number; date: string; voucher_id: number | null; voucher: string | null; supplier_invoice_id: number | null;
  text_source: string | null; has_text: boolean; tags: string[] }

/** Underlagen för ett räkenskapsår (datum = verifikationens datum, annars uppladdningsdagen) */
export async function documents(companyId: number, fyId: number, f: { tag?: string } = {}) {
  const fy = (await fiscalYears(companyId)).find((y) => y.id === fyId);
  if (!fy) throw new NotFoundError('Räkenskapsåret');
  const rows = await sql<Doc[]>`SELECT a.id, a.filename, a.mime_type, octet_length(a.data) AS size, to_char(COALESCE(v.date, a.created_at::date),'YYYY-MM-DD') AS date,
      a.voucher_id, v.series || v.number AS voucher, a.supplier_invoice_id, a.text_source, (a.text IS NOT NULL) AS has_text,
      COALESCE((SELECT array_agg(t.tag ORDER BY t.tag) FROM attachment_tags t WHERE t.attachment_id = a.id), '{}') AS tags
    FROM attachments a LEFT JOIN vouchers v ON v.id = a.voucher_id
    WHERE a.company_id = ${companyId} AND COALESCE(v.date, a.created_at::date) BETWEEN ${fy.start_date} AND ${fy.end_date}
      ${f.tag ? sql`AND EXISTS (SELECT 1 FROM attachment_tags t WHERE t.attachment_id = a.id AND t.tag = ${f.tag})` : sql``}
    ORDER BY COALESCE(v.date, a.created_at::date) DESC, a.id DESC LIMIT 500`;
  const tags = await sql<{ tag: string; n: number }[]>`SELECT t.tag, count(*)::int AS n FROM attachment_tags t WHERE t.company_id = ${companyId} GROUP BY t.tag ORDER BY t.tag`;
  return { fy, docs: [...rows], tags: [...tags], retention: retentionUntil(fy.end_date) };
}

export async function addTag(actor: Actor, attachmentId: number, raw: string) {
  const tag = normalizeTag(raw);
  if (!tag) throw new ValidationError('Taggen ska vara 2–30 tecken (bokstäver, siffror och bindestreck)');
  const [a] = await sql`SELECT 1 FROM attachments WHERE id = ${attachmentId} AND company_id = ${actor.companyId}`;
  if (!a) throw new NotFoundError('Underlaget');
  await sql`INSERT INTO attachment_tags (attachment_id, company_id, tag) VALUES (${attachmentId}, ${actor.companyId}, ${tag}) ON CONFLICT DO NOTHING`;
  await auditBy(sql, actor, 'tag', 'attachment', attachmentId, { tag });
  return tag;
}

export async function removeTag(actor: Actor, attachmentId: number, tag: string) {
  await sql`DELETE FROM attachment_tags WHERE attachment_id = ${attachmentId} AND company_id = ${actor.companyId} AND tag = ${tag}`;
  await auditBy(sql, actor, 'untag', 'attachment', attachmentId, { tag });
}

/** Kontrollsumma över årets verifikationer (rader) och underlag (SHA-256 av filerna) – ändras något syns det */
async function seal(companyId: number, from: string, to: string): Promise<{ seal: string; vouchers: number; files: number }> {
  const [r] = await sql<{ seal: string; vouchers: number; files: number }[]>`
    WITH v AS (SELECT * FROM vouchers WHERE company_id = ${companyId} AND date BETWEEN ${from} AND ${to}),
    parts AS (
      SELECT 'v' || lpad(v.id::text, 12, '0') AS k, concat_ws(';', v.id, v.series || v.number, v.date, v.description,
        (SELECT string_agg(l.account_number || ':' || l.debit || ':' || l.credit, ',' ORDER BY l.id) FROM voucher_lines l WHERE l.voucher_id = v.id)) AS x FROM v
      UNION ALL
      SELECT 'a' || lpad(a.id::text, 12, '0'), a.id || ';' || encode(sha256(a.data), 'hex') FROM attachments a JOIN v ON v.id = a.voucher_id)
    SELECT encode(sha256(convert_to(COALESCE(string_agg(x, '|' ORDER BY k), ''), 'UTF8')), 'hex') AS seal,
      (SELECT count(*)::int FROM v) AS vouchers, (SELECT count(*)::int FROM attachments a JOIN v ON v.id = a.voucher_id) AS files FROM parts`;
  return r;
}

export async function archiveYears(companyId: number) {
  const ys = await sql<{ id: number; start_date: string; end_date: string; closed: boolean; archived_at: string | null; archive_seal: string | null; by: string | null }[]>`
    SELECT f.id, to_char(f.start_date,'YYYY-MM-DD') AS start_date, to_char(f.end_date,'YYYY-MM-DD') AS end_date, f.closed, to_char(f.archived_at,'YYYY-MM-DD') AS archived_at, f.archive_seal, u.name AS by
    FROM fiscal_years f LEFT JOIN users u ON u.id = f.archived_by WHERE f.company_id = ${companyId} ORDER BY f.start_date DESC`;
  return ys.map((y) => ({ ...y, retention: retentionUntil(y.end_date) }));
}

/** Arkiverar ett stängt år: förseglas med kontrollsumma och tas bort ur standardsökningen (finns kvar och kan sökas fram) */
export async function archiveYear(actor: Actor, fyId: number) {
  if (actor.role !== 'owner') throw new ValidationError('Bara ägaren kan arkivera räkenskapsår');
  const [y] = await sql<{ start_date: string; end_date: string; closed: boolean; archived_at: Date | null }[]>`SELECT to_char(start_date,'YYYY-MM-DD') AS start_date,
    to_char(end_date,'YYYY-MM-DD') AS end_date, closed, archived_at FROM fiscal_years WHERE id = ${fyId} AND company_id = ${actor.companyId}`;
  if (!y) throw new NotFoundError('Räkenskapsåret');
  if (!y.closed) throw new ConflictError('Stäng räkenskapsåret i bokslutet innan det arkiveras');
  if (y.archived_at) throw new ConflictError('Året är redan arkiverat');
  const s = await seal(actor.companyId, y.start_date, y.end_date);
  await sql`UPDATE fiscal_years SET archived_at = now(), archive_seal = ${s.seal}, archived_by = ${actor.userId} WHERE id = ${fyId}`;
  await auditBy(sql, actor, 'archive', 'fiscal_year', fyId, s);
  return s;
}

export async function verifyYear(companyId: number, fyId: number) {
  const [y] = await sql<{ start_date: string; end_date: string; archive_seal: string | null }[]>`SELECT to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date, archive_seal
    FROM fiscal_years WHERE id = ${fyId} AND company_id = ${companyId}`;
  if (!y?.archive_seal) throw new NotFoundError('Arkiverat räkenskapsår');
  const s = await seal(companyId, y.start_date, y.end_date);
  return { ok: s.seal === y.archive_seal, ...s, stored: y.archive_seal };
}

export async function unarchiveYear(actor: Actor, fyId: number) {
  if (actor.role !== 'owner') throw new ValidationError('Bara ägaren kan återställa arkiverade år');
  const r = await sql`UPDATE fiscal_years SET archived_at = NULL WHERE id = ${fyId} AND company_id = ${actor.companyId} AND archived_at IS NOT NULL RETURNING id`;
  if (!r.length) throw new NotFoundError('Arkiverat räkenskapsår');
  await auditBy(sql, actor, 'unarchive', 'fiscal_year', fyId);
}
