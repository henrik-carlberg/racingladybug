import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { createVoucher, reverseVoucher } from '@/lib/server/ledger';
import { auditBy } from '@/lib/server/audit';
import type { Line } from '@/lib/ledger-lines';
import type { Actor } from './actor';
import { arr, date, list, optInt, str, type Page } from './input';

export interface VoucherOut {
  id: number; object: 'voucher'; series: string; number: number; date: string; description: string;
  source_type: string; source_id: number | null; corrects_id: number | null; corrected_by_id: number | null;
  created_at: string; lines: { account: number; debit: number; credit: number; description: string }[];
}

export async function getVoucher(companyId: number, id: number): Promise<VoucherOut> {
  const [v] = await sql<Omit<VoucherOut, 'lines' | 'object'>[]>`
    SELECT v.id, v.series, v.number, to_char(v.date,'YYYY-MM-DD') AS date, v.description, v.source_type, v.source_id, v.corrects_id,
      (SELECT r.id FROM vouchers r WHERE r.corrects_id = v.id LIMIT 1) AS corrected_by_id, v.created_at
    FROM vouchers v WHERE v.id = ${id} AND v.company_id = ${companyId}`;
  if (!v) throw new NotFoundError('Verifikationen');
  const lines = await sql<{ account: number; debit: number; credit: number; description: string }[]>`
    SELECT account_number AS account, debit, credit, description FROM voucher_lines WHERE voucher_id = ${id} ORDER BY id`;
  return { ...v, object: 'voucher', lines: [...lines] };
}

export async function listVouchers(companyId: number, p: Page, f: { from?: string; to?: string; series?: string }) {
  const rows = await sql<{ id: number }[]>`
    SELECT id FROM vouchers WHERE company_id = ${companyId}
      ${f.from ? sql`AND date >= ${f.from}` : sql``} ${f.to ? sql`AND date <= ${f.to}` : sql``}
      ${f.series ? sql`AND series = ${f.series}` : sql``}
      ${p.startingAfter ? sql`AND id > ${p.startingAfter}` : sql``}
    ORDER BY id LIMIT ${p.limit + 1}`;
  const res = list(rows, p);
  return { ...res, data: await Promise.all(res.data.map((r) => getVoucher(companyId, r.id))) };
}

export interface AttachmentIn { filename: string; mimeType: string; data: Buffer }

/** Manuell verifikation. Belopp i öre. */
export async function createManualVoucher(actor: Actor, input: Record<string, unknown>, attachment?: AttachmentIn | null) {
  const lines: Line[] = arr(input, 'lines', 'Rader').map((r, i) => {
    const account = optInt(r, 'account', `Rad ${i + 1}: konto`);
    const debit = optInt(r, 'debit', `Rad ${i + 1}: debet`) ?? 0;
    const credit = optInt(r, 'credit', `Rad ${i + 1}: kredit`) ?? 0;
    if (!account) throw new ValidationError(`Rad ${i + 1}: konto saknas`);
    if (debit && credit) throw new ValidationError(`Rad ${i + 1}: ange antingen debet eller kredit`);
    return { account, debit, credit, description: str(r, 'description') };
  });
  const id = await sql.begin(async (tx) => {
    const v = await createVoucher(tx, {
      actor, date: date(input, 'date', 'Datum'), description: str(input, 'description', { required: true, label: 'Beskrivning' }), lines,
      series: str(input, 'series') || 'A',
    });
    if (attachment) await insertAttachment(tx, actor, v.id, attachment);
    return v.id;
  });
  return getVoucher(actor.companyId, id);
}

async function insertAttachment(tx: typeof sql | Tx, actor: Actor, voucherId: number | null, a: AttachmentIn, supplierInvoiceId: number | null = null) {
  if (a.data.length > 8_000_000) throw new ValidationError('Filen är för stor (max 8 MB)');
  const [r] = await tx<{ id: number }[]>`INSERT INTO attachments (company_id, voucher_id, supplier_invoice_id, filename, mime_type, data, uploaded_by)
    VALUES (${actor.companyId}, ${voucherId}, ${supplierInvoiceId}, ${a.filename}, ${a.mimeType || 'application/octet-stream'}, ${a.data}, ${actor.userId}) RETURNING id`;
  await auditBy(tx, actor, 'upload', 'attachment', r.id, { voucher: voucherId, filename: a.filename });
  return r.id;
}
export { insertAttachment };

export async function addAttachment(actor: Actor, voucherId: number, a: AttachmentIn) {
  const [v] = await sql`SELECT id FROM vouchers WHERE id = ${voucherId} AND company_id = ${actor.companyId}`;
  if (!v) throw new NotFoundError('Verifikationen');
  return insertAttachment(sql, actor, voucherId, a);
}

export async function reverse(actor: Actor, voucherId: number, input: Record<string, unknown>) {
  const v = await sql.begin((tx) => reverseVoucher(tx, actor, voucherId, date(input, 'date', 'Datum'), str(input, 'reason')));
  return getVoucher(actor.companyId, v.id);
}
