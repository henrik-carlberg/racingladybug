'use server';
import { sql } from '@/lib/db';
import { attempt, done, int, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { audit } from '@/lib/server/audit';

function fields(fd: FormData) {
  const name = str(fd, 'name');
  if (!name) throw new Error('Ange kundens namn');
  return {
    name, orgnr: str(fd, 'orgnr'), vat_number: str(fd, 'vat_number').toUpperCase().replace(/\s/g, ''), email: str(fd, 'email'),
    address: str(fd, 'address'), postal_code: str(fd, 'postal_code'), city: str(fd, 'city'),
    country: (str(fd, 'country') || 'SE').toUpperCase(), payment_terms: int(fd, 'payment_terms'),
    reverse_charge: fd.get('reverse_charge') === 'on',
  };
}

export async function saveCustomer(cid: number, id: number | null, fd: FormData) {
  const { company, user } = await requireCompany(cid);
  const back = id ? `/c/${cid}/kunder/${id}` : `/c/${cid}/kunder`;
  await attempt(back, async () => {
    const f = fields(fd);
    if (f.reverse_charge && !f.vat_number) throw new Error('Omvänd skattskyldighet kräver kundens momsregistreringsnummer');
    if (id) await sql`UPDATE customers SET ${sql(f)} WHERE id = ${id} AND company_id = ${company.id}`;
    else [{ id }] = await sql<{ id: number }[]>`INSERT INTO customers ${sql({ ...f, company_id: company.id })} RETURNING id`;
    await audit(sql, { companyId: company.id, userId: user.id, action: 'save', entity: 'customer', entityId: id });
  });
  done(`/c/${cid}/kunder`, 'Kunden är sparad');
}
