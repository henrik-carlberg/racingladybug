'use server';
import { sql } from '@/lib/db';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { createVoucher, reverseVoucher } from '@/lib/server/ledger';
import { audit } from '@/lib/server/audit';
import { parseAmount } from '@/lib/money';
import type { Line } from '@/lib/ledger-lines';
import { unstable_rethrow } from 'next/navigation';

export type FormState = { error?: string } | undefined;

export async function saveVoucher(cid: number, _prev: FormState, fd: FormData): Promise<FormState> {
  const { company, user } = await requireCompany(cid);
  let id = 0;
  try {
    const raw = JSON.parse(str(fd, 'lines') || '[]') as { account: string; debit: string; credit: string; description: string }[];
    const lines: Line[] = raw
      .filter((r) => r.account || r.debit || r.credit)
      .map((r, i) => {
        const account = Number(r.account);
        const debit = r.debit ? parseAmount(r.debit) : 0;
        const credit = r.credit ? parseAmount(r.credit) : 0;
        if (!account) throw new Error(`Rad ${i + 1}: konto saknas`);
        if (debit == null || credit == null) throw new Error(`Rad ${i + 1}: ogiltigt belopp`);
        if (debit && credit) throw new Error(`Rad ${i + 1}: ange antingen debet eller kredit`);
        return { account, debit, credit, description: r.description };
      });
    const file = fd.get('file');
    id = await sql.begin(async (tx) => {
      const v = await createVoucher(tx, { companyId: company.id, userId: user.id, date: str(fd, 'date'), description: str(fd, 'description'), lines });
      if (file instanceof File && file.size > 0) {
        await tx`INSERT INTO attachments (company_id, voucher_id, filename, mime_type, data, uploaded_by)
          VALUES (${company.id}, ${v.id}, ${file.name}, ${file.type || 'application/octet-stream'}, ${Buffer.from(await file.arrayBuffer())}, ${user.id})`;
      }
      return v.id;
    });
  } catch (e) {
    unstable_rethrow(e);
    return { error: e instanceof Error ? e.message : 'Något gick fel' };
  }
  done(`/c/${cid}/verifikationer/${id}`, 'Verifikationen är bokförd');
}

export async function reverse(cid: number, vid: number, fd: FormData) {
  const { company, user } = await requireCompany(cid);
  let newId = 0;
  await attempt(`/c/${cid}/verifikationer/${vid}`, async () => {
    newId = (await sql.begin((tx) => reverseVoucher(tx, company.id, user.id, vid, str(fd, 'date'), str(fd, 'reason')))).id;
  });
  done(`/c/${cid}/verifikationer/${newId}`, 'Rättelseverifikationen är bokförd');
}

export async function uploadAttachment(cid: number, vid: number, fd: FormData) {
  const { company, user } = await requireCompany(cid);
  await attempt(`/c/${cid}/verifikationer/${vid}`, async () => {
    const file = fd.get('file');
    if (!(file instanceof File) || file.size === 0) throw new Error('Välj en fil');
    if (file.size > 8_000_000) throw new Error('Filen är för stor (max 8 MB)');
    const [v] = await sql`SELECT id FROM vouchers WHERE id = ${vid} AND company_id = ${company.id}`;
    if (!v) throw new Error('Verifikationen finns inte');
    const [a] = await sql<{ id: number }[]>`INSERT INTO attachments (company_id, voucher_id, filename, mime_type, data, uploaded_by)
      VALUES (${company.id}, ${vid}, ${file.name}, ${file.type || 'application/octet-stream'}, ${Buffer.from(await file.arrayBuffer())}, ${user.id}) RETURNING id`;
    await audit(sql, { companyId: company.id, userId: user.id, action: 'upload', entity: 'attachment', entityId: a.id, details: { voucher: vid, filename: file.name } });
  });
  done(`/c/${cid}/verifikationer/${vid}`, 'Underlaget är uppladdat');
}
