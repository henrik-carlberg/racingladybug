'use server';
import { sql } from '@/lib/db';
import { attempt, done, int, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { audit } from '@/lib/server/audit';

export async function saveSupplier(cid: number, id: number | null, fd: FormData) {
  const { company, user } = await requireCompany(cid);
  await attempt(id ? `/c/${cid}/leverantorer/${id}` : `/c/${cid}/leverantorer`, async () => {
    const f = {
      name: str(fd, 'name'), orgnr: str(fd, 'orgnr'), bankgiro: str(fd, 'bankgiro'), plusgiro: str(fd, 'plusgiro'),
      bank_account: str(fd, 'bank_account'), default_account: int(fd, 'default_account') ?? 4010, email: str(fd, 'email'),
    };
    if (!f.name) throw new Error('Ange leverantörens namn');
    if (id) await sql`UPDATE suppliers SET ${sql(f)} WHERE id = ${id} AND company_id = ${company.id}`;
    else [{ id }] = await sql<{ id: number }[]>`INSERT INTO suppliers ${sql({ ...f, company_id: company.id })} RETURNING id`;
    await audit(sql, { companyId: company.id, userId: user.id, action: 'save', entity: 'supplier', entityId: id });
  });
  done(`/c/${cid}/leverantorer`, 'Leverantören är sparad');
}
