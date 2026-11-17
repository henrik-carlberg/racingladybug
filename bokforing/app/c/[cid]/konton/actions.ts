'use server';
import { sql } from '@/lib/db';
import { attempt, done, int, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { audit } from '@/lib/server/audit';

export async function addAccount(cid: number, fd: FormData) {
  const { company, user } = await requireCompany(cid);
  await attempt(`/c/${cid}/konton`, async () => {
    const n = int(fd, 'number');
    if (!n || n < 1000 || n > 9999) throw new Error('Kontonummer måste vara 1000–9999');
    const name = str(fd, 'name');
    if (!name) throw new Error('Ange kontonamn');
    await sql`INSERT INTO accounts (company_id, number, name) VALUES (${company.id}, ${n}, ${name})
      ON CONFLICT (company_id, number) DO UPDATE SET name = EXCLUDED.name, active = true`;
    await audit(sql, { companyId: company.id, userId: user.id, action: 'upsert', entity: 'account', entityId: n, details: { name } });
  });
  done(`/c/${cid}/konton`, 'Kontot är sparat');
}

export async function toggleAccount(cid: number, n: number) {
  const { company, user } = await requireCompany(cid);
  await sql`UPDATE accounts SET active = NOT active WHERE company_id = ${company.id} AND number = ${n}`;
  await audit(sql, { companyId: company.id, userId: user.id, action: 'toggle', entity: 'account', entityId: n });
  done(`/c/${cid}/konton`);
}
