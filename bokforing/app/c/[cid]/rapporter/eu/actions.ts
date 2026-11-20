'use server';
import { sql } from '@/lib/db';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { audit } from '@/lib/server/audit';

export async function setOss(cid: number, fd: FormData) {
  const { company, user } = await requireCompany(cid, { owner: true });
  const on = fd.get('oss') === 'on';
  await attempt(`/c/${cid}/rapporter/eu`, async () => {
    await sql`UPDATE companies SET oss_registered = ${on} WHERE id = ${company.id}`;
    await audit(sql, { companyId: company.id, userId: user.id, action: 'oss', entity: 'company', entityId: company.id, details: { on } });
  });
  done(`/c/${cid}/rapporter/eu`, on ? 'Bolaget är registrerat för OSS – fakturor till privatpersoner i andra EU-länder får köparlandets moms' : 'OSS är avstängt');
}
