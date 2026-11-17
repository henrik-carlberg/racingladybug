'use server';
import { sql } from '@/lib/db';
import { attempt, done, int, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { audit } from '@/lib/server/audit';
import { normalizePersonalNumber } from '@/lib/validate';
import { parseAmount } from '@/lib/money';

export async function saveEmployee(cid: number, id: number | null, fd: FormData) {
  const { company, user } = await requireCompany(cid);
  await attempt(id ? `/c/${cid}/lon/anstallda/${id}` : `/c/${cid}/lon/anstallda`, async () => {
    const pnr = normalizePersonalNumber(str(fd, 'personal_number'));
    if (!pnr) throw new Error('Ogiltigt personnummer');
    const salary = parseAmount(str(fd, 'monthly_salary') || '0');
    if (salary == null || salary < 0) throw new Error('Ogiltig månadslön');
    const mode = str(fd, 'tax_mode') === 'percent' ? 'percent' : 'table';
    const table = int(fd, 'tax_table');
    const pct = str(fd, 'tax_percent') ? Number(str(fd, 'tax_percent').replace(',', '.')) : null;
    if (mode === 'table' && (!table || table < 29 || table > 42)) throw new Error('Ange skattetabell (29–42)');
    if (mode === 'percent' && (pct == null || pct < 0 || pct > 100)) throw new Error('Ange skattesats i procent');
    const fee = str(fd, 'fee_override') ? Number(str(fd, 'fee_override').replace(',', '.')) : null;
    const f = {
      first_name: str(fd, 'first_name'), last_name: str(fd, 'last_name'), personal_number: pnr, email: str(fd, 'email'),
      address: str(fd, 'address'), postal_code: str(fd, 'postal_code'), city: str(fd, 'city'),
      bank_clearing: str(fd, 'bank_clearing'), bank_account: str(fd, 'bank_account'),
      employment_start: str(fd, 'employment_start') || null, employment_end: str(fd, 'employment_end') || null,
      monthly_salary: salary, tax_mode: mode, tax_table: table, tax_column: int(fd, 'tax_column') ?? 1, tax_percent: pct,
      fee_override: fee, active: fd.get('active') === 'on',
    };
    if (!f.first_name || !f.last_name) throw new Error('Ange för- och efternamn');
    if (id) await sql`UPDATE employees SET ${sql(f)} WHERE id = ${id} AND company_id = ${company.id}`;
    else [{ id }] = await sql<{ id: number }[]>`INSERT INTO employees ${sql({ ...f, company_id: company.id })} RETURNING id`;
    await audit(sql, { companyId: company.id, userId: user.id, action: 'save', entity: 'employee', entityId: id });
  });
  done(`/c/${cid}/lon/anstallda`, 'Den anställda är sparad');
}
