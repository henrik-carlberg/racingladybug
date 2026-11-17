'use server';
import { sql } from '@/lib/db';
import { attempt, done, str } from '@/lib/server/action';
import { requireUser } from '@/lib/server/auth';
import { audit } from '@/lib/server/audit';
import { basAccountsFor } from '@/lib/bas';
import { normalizeOrgNumber, normalizePersonalNumber } from '@/lib/validate';
import { defaultFiscalEnd, fiscalYearError } from '@/lib/fiscal';

export async function createCompany(fd: FormData) {
  const user = await requireUser();
  let id = 0;
  await attempt('/', async () => {
    const type = str(fd, 'company_type') === 'EF' ? 'EF' : 'AB';
    const raw = str(fd, 'orgnr');
    const orgnr = type === 'EF' ? (normalizePersonalNumber(raw)?.slice(2).replace(/^(\d{6})/, '$1-') ?? null) : normalizeOrgNumber(raw);
    if (!orgnr) throw new Error(type === 'EF' ? 'Ogiltigt personnummer' : 'Ogiltigt organisationsnummer');
    const start = str(fd, 'fy_start');
    const end = str(fd, 'fy_end') || defaultFiscalEnd(start, type);
    const fyErr = fiscalYearError(start, end, type);
    if (fyErr) throw new Error(fyErr);
    const vat = ['month', 'quarter', 'year'].includes(str(fd, 'vat_period')) ? str(fd, 'vat_period') : 'quarter';
    const method = str(fd, 'accounting_method') === 'cash' ? 'cash' : 'invoice';
    await sql.begin(async (tx) => {
      const [c] = await tx<{ id: number }[]>`
        INSERT INTO companies (name, orgnr, company_type, vat_period, accounting_method)
        VALUES (${str(fd, 'name')}, ${orgnr}, ${type}, ${vat}, ${method}) RETURNING id`;
      id = c.id;
      await tx`INSERT INTO memberships (user_id, company_id, role) VALUES (${user.id}, ${id}, 'owner')`;
      await tx`INSERT INTO fiscal_years (company_id, start_date, end_date) VALUES (${id}, ${start}, ${end})`;
      await tx`INSERT INTO accounts ${tx(basAccountsFor(type).map((a) => ({ company_id: id, ...a })))}`;
      await audit(tx, { companyId: id, userId: user.id, action: 'create', entity: 'company', entityId: id });
    });
  });
  done(`/c/${id}/kom-igang`, 'Bolaget är skapat! Följ stegen nedan för att komma igång.');
}
