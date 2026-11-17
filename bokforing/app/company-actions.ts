'use server';
import { sql } from '@/lib/db';
import { attempt, done, str } from '@/lib/server/action';
import { requireUser } from '@/lib/server/auth';
import { audit } from '@/lib/server/audit';
import { basAccountsFor } from '@/lib/bas';
import { normalizeOrgNumber, normalizePersonalNumber } from '@/lib/validate';
import { addDays } from '@/lib/format';

export async function createCompany(fd: FormData) {
  const user = await requireUser();
  let id = 0;
  await attempt('/', async () => {
    const type = str(fd, 'company_type') === 'EF' ? 'EF' : 'AB';
    const raw = str(fd, 'orgnr');
    const orgnr = type === 'EF' ? (normalizePersonalNumber(raw)?.slice(2).replace(/^(\d{6})/, '$1-') ?? null) : normalizeOrgNumber(raw);
    if (!orgnr) throw new Error(type === 'EF' ? 'Ogiltigt personnummer' : 'Ogiltigt organisationsnummer');
    const start = str(fd, 'fy_start');
    if (!/^\d{4}-\d{2}-01$/.test(start)) throw new Error('Räkenskapsåret måste börja den 1:a i en månad');
    const end = addDays(new Date(Date.UTC(Number(start.slice(0, 4)) + 1, Number(start.slice(5, 7)) - 1, 1)).toISOString().slice(0, 10), -1);
    await sql.begin(async (tx) => {
      const [c] = await tx<{ id: number }[]>`
        INSERT INTO companies (name, orgnr, company_type, vat_period)
        VALUES (${str(fd, 'name')}, ${orgnr}, ${type}, ${str(fd, 'vat_period') || 'quarter'}) RETURNING id`;
      id = c.id;
      await tx`INSERT INTO memberships (user_id, company_id, role) VALUES (${user.id}, ${id}, 'owner')`;
      await tx`INSERT INTO fiscal_years (company_id, start_date, end_date) VALUES (${id}, ${start}, ${end})`;
      await tx`INSERT INTO accounts ${tx(basAccountsFor(type).map((a) => ({ company_id: id, ...a })))}`;
      await audit(tx, { companyId: id, userId: user.id, action: 'create', entity: 'company', entityId: id });
    });
  });
  done(`/c/${id}/installningar`, 'Bolaget är skapat. Fyll i adress- och betalningsuppgifter.');
}
