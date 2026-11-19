import 'server-only';
import { sql } from '@/lib/db';
import { parseQuery, prefixQuery } from '@/lib/doc-text';
import type { Permission } from '@/lib/permissions';

export type HitKind = 'voucher' | 'invoice' | 'supplier_invoice' | 'customer' | 'supplier' | 'document' | 'bank';
export interface Hit { kind: HitKind; id: number; title: string; date: string | null; amount: number | null; snippet: string; href: string; archived: boolean }
export const KIND_LABEL: Record<HitKind, string> = { voucher: 'Verifikationer', invoice: 'Kundfakturor', supplier_invoice: 'Leverantörsfakturor', customer: 'Kunder', supplier: 'Leverantörer', document: 'Underlag och dokument', bank: 'Banktransaktioner' };

/**
 * Sök i allt bolaget har: verifikationer, fakturor, kunder, leverantörer, banktransaktioner och texten i underlagen (även OCR).
 * Bara det användaren har behörighet att se. Arkiverade år tas med bara på begäran.
 */
export async function searchAll(companyId: number, q: string, o: { can: (p: Permission) => boolean; year?: number; includeArchived?: boolean; kind?: HitKind; limit?: number }): Promise<Hit[]> {
  const { text, amount, number } = parseQuery(q);
  const tsq = prefixQuery(text);
  if (!tsq && amount == null && !number) return [];
  const lim = Math.min(o.limit ?? 20, 100);
  const tq = sql`to_tsquery('swedish', ${tsq ?? 'xqzxqz'})`;
  const like = '%' + text.replace(/[%_\\]/g, (c) => '\\' + c) + '%';
  const yr = (col: ReturnType<typeof sql>) => (o.year ? sql`AND extract(year FROM ${col}) = ${o.year}` : sql``);
  const archived = (col: ReturnType<typeof sql>) => sql`EXISTS (SELECT 1 FROM fiscal_years f WHERE f.company_id = ${companyId} AND f.archived_at IS NOT NULL AND ${col} BETWEEN f.start_date AND f.end_date)`;
  const arch = (col: ReturnType<typeof sql>) => (o.includeArchived ? sql`` : sql`AND NOT ${archived(col)}`);
  const hl = (doc: ReturnType<typeof sql>) => (tsq ? sql`ts_headline('swedish', ${doc}, ${tq}, 'StartSel=[[, StopSel=]], MaxFragments=2, MaxWords=18, MinWords=6')` : sql`left(${doc}, 160)`);
  const want = (k: HitKind) => !o.kind || o.kind === k;
  const jobs: Promise<Hit[]>[] = [];
  const run = (p: Promise<Hit[]>) => jobs.push(p.then((r) => [...r]));

  if (o.can('ledger') && want('voucher')) run(sql<Hit[]>`
    SELECT 'voucher' AS kind, v.id, v.series || v.number || ' · ' || v.description AS title, to_char(v.date,'YYYY-MM-DD') AS date,
      (SELECT SUM(debit)::float8 FROM voucher_lines WHERE voucher_id = v.id) AS amount, ${hl(sql`v.description`)} AS snippet, '/verifikationer/' || v.id AS href, ${archived(sql`v.date`)} AS archived
    FROM vouchers v WHERE v.company_id = ${companyId} ${yr(sql`v.date`)} ${arch(sql`v.date`)}
      AND (to_tsvector('swedish', v.description) @@ ${tq} OR (v.series || v.number) = ${text.toUpperCase().replace(/\s/g, '')}
        ${amount != null ? sql`OR EXISTS (SELECT 1 FROM voucher_lines l WHERE l.voucher_id = v.id AND (l.debit = ${Math.abs(amount)} OR l.credit = ${Math.abs(amount)}))` : sql``})
    ORDER BY v.date DESC LIMIT ${lim}`);

  if (o.can('invoicing') && want('invoice')) run(sql<Hit[]>`
    SELECT 'invoice' AS kind, i.id, 'Faktura ' || COALESCE(i.invoice_number::text, 'utkast') || ' · ' || c.name AS title, to_char(i.invoice_date,'YYYY-MM-DD') AS date, i.total::float8 AS amount,
      ${hl(sql`c.name || ' ' || COALESCE((SELECT string_agg(description, ' · ') FROM invoice_lines WHERE invoice_id = i.id), '')`)} AS snippet, '/fakturor/' || i.id AS href, ${archived(sql`i.invoice_date`)} AS archived
    FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.company_id = ${companyId} ${yr(sql`i.invoice_date`)} ${arch(sql`i.invoice_date`)}
      AND (to_tsvector('swedish', c.name) @@ ${tq} OR EXISTS (SELECT 1 FROM invoice_lines l WHERE l.invoice_id = i.id AND to_tsvector('swedish', l.description) @@ ${tq})
        ${number ? sql`OR i.invoice_number::text = ${number} OR i.ocr = ${number}` : sql``} ${amount != null ? sql`OR i.total = ${amount}` : sql``})
    ORDER BY i.invoice_date DESC LIMIT ${lim}`);

  if (o.can('purchasing') && want('supplier_invoice')) run(sql<Hit[]>`
    SELECT 'supplier_invoice' AS kind, i.id, s.name || ' · ' || i.invoice_number AS title, to_char(i.invoice_date,'YYYY-MM-DD') AS date, i.total::float8 AS amount,
      ${hl(sql`s.name || ' ' || i.description || ' ' || i.payment_reference`)} AS snippet, '/leverantorsfakturor/' || i.id AS href, ${archived(sql`i.invoice_date`)} AS archived
    FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id WHERE i.company_id = ${companyId} ${yr(sql`i.invoice_date`)} ${arch(sql`i.invoice_date`)}
      AND (to_tsvector('swedish', i.description || ' ' || i.invoice_number || ' ' || i.payment_reference) @@ ${tq} OR to_tsvector('swedish', s.name) @@ ${tq}
        ${number ? sql`OR i.invoice_number = ${number} OR i.payment_reference = ${number}` : sql``} ${amount != null ? sql`OR i.total = ${amount}` : sql``})
    ORDER BY i.invoice_date DESC LIMIT ${lim}`);

  if (o.can('invoicing') && want('customer') && !o.year) run(sql<Hit[]>`
    SELECT 'customer' AS kind, id, name AS title, NULL AS date, NULL::float8 AS amount, concat_ws(' · ', NULLIF(orgnr,''), NULLIF(email,''), NULLIF(city,'')) AS snippet, '/kunder/' || id AS href, false AS archived
    FROM customers WHERE company_id = ${companyId} AND (to_tsvector('swedish', name) @@ ${tq} OR name ILIKE ${like} OR orgnr = ${text} OR email ILIKE ${like}) ORDER BY name LIMIT ${lim}`);

  if (o.can('purchasing') && want('supplier') && !o.year) run(sql<Hit[]>`
    SELECT 'supplier' AS kind, id, name AS title, NULL AS date, NULL::float8 AS amount, concat_ws(' · ', NULLIF(orgnr,''), NULLIF(bankgiro,'')) AS snippet, '/leverantorer/' || id AS href, false AS archived
    FROM suppliers WHERE company_id = ${companyId} AND (to_tsvector('swedish', name) @@ ${tq} OR name ILIKE ${like} OR orgnr = ${text} OR bankgiro = ${text}) ORDER BY name LIMIT ${lim}`);

  if ((o.can('ledger') || o.can('purchasing')) && want('document')) {
    const docDate = sql`COALESCE(v.date, a.created_at::date)` as ReturnType<typeof sql>;
    run(sql<Hit[]>`
      SELECT 'document' AS kind, a.id, a.filename || COALESCE(' · ' || v.series || v.number, '') AS title, to_char(${docDate},'YYYY-MM-DD') AS date, NULL::float8 AS amount,
        ${hl(sql`a.filename || ' ' || COALESCE(a.text, '')`)} AS snippet, '/underlag/' || a.id AS href, ${archived(docDate)} AS archived
      FROM attachments a LEFT JOIN vouchers v ON v.id = a.voucher_id
      WHERE a.company_id = ${companyId} ${yr(docDate)} ${arch(docDate)}
        ${o.can('ledger') ? sql`` : sql`AND a.supplier_invoice_id IS NOT NULL`}
        AND (to_tsvector('swedish', a.filename || ' ' || COALESCE(a.text, '')) @@ ${tq} OR EXISTS (SELECT 1 FROM attachment_tags t WHERE t.attachment_id = a.id AND t.tag = ${text.toLowerCase()}))
      ORDER BY ${docDate} DESC LIMIT ${lim}`);
  }

  if (o.can('ledger') && want('bank')) run(sql<Hit[]>`
    SELECT 'bank' AS kind, t.id, COALESCE(NULLIF(t.counterparty,''), t.description) AS title, to_char(t.booking_date,'YYYY-MM-DD') AS date, t.amount::float8 AS amount,
      ${hl(sql`t.description || ' ' || t.counterparty || ' ' || t.reference`)} AS snippet,
      CASE WHEN t.voucher_id IS NOT NULL THEN '/verifikationer/' || t.voucher_id ELSE '/bank/avstamning' END AS href, ${archived(sql`t.booking_date`)} AS archived
    FROM bank_transactions t WHERE t.company_id = ${companyId} ${yr(sql`t.booking_date`)} ${arch(sql`t.booking_date`)}
      AND (to_tsvector('swedish', t.description || ' ' || t.counterparty || ' ' || t.reference) @@ ${tq} ${amount != null ? sql`OR abs(t.amount) = ${Math.abs(amount)}` : sql``}
        ${number ? sql`OR t.reference = ${number}` : sql``})
    ORDER BY t.booking_date DESC LIMIT ${lim}`);

  return (await Promise.all(jobs)).flat();
}
