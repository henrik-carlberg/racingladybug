'use server';
import { sql } from '@/lib/db';
import { attempt, done, str } from '@/lib/server/action';
import { requireUser } from '@/lib/server/auth';
import { audit } from '@/lib/server/audit';
import { basAccountsFor } from '@/lib/bas';
import { normalizeOrgNumber, normalizePersonalNumber } from '@/lib/validate';
import { defaultFiscalEnd, fiscalYearError } from '@/lib/fiscal';
import { startTrial } from '@/lib/services/billing';

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
      await startTrial(tx, id);
      await tx`INSERT INTO fiscal_years (company_id, start_date, end_date) VALUES (${id}, ${start}, ${end})`;
      await tx`INSERT INTO accounts ${tx(basAccountsFor(type).map((a) => ({ company_id: id, ...a })))}`;
      await audit(tx, { companyId: id, userId: user.id, action: 'create', entity: 'company', entityId: id });
    });
  });
  done(`/c/${id}/kom-igang`, 'Bolaget är skapat! Följ stegen nedan för att komma igång.');
}

export async function createDemo() {
  const user = await requireUser();
  const { createDemoCompany } = await import('@/lib/services/demo');
  let id = 0;
  await attempt('/', async () => {
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM companies c JOIN memberships m ON m.company_id = c.id WHERE m.user_id = ${user.id} AND c.is_demo`;
    if (n >= 2) throw new Error('Du har redan demobolag');
    id = await createDemoCompany(user.id);
  });
  done(`/c/${id}`, 'Demobolaget är skapat med exempeldata. Prova fritt!');
}

/** Tar bort ett demobolag helt (bara demobolag kan tas bort) */
export async function deleteDemo(cid: number) {
  const user = await requireUser();
  await attempt(`/c/${cid}`, async () => {
    const [c] = await sql`SELECT 1 FROM companies c JOIN memberships m ON m.company_id = c.id WHERE c.id = ${cid} AND c.is_demo AND m.user_id = ${user.id} AND m.role = 'owner'`;
    if (!c) throw new Error('Bara demobolag kan tas bort');
    await sql`DELETE FROM companies WHERE id = ${cid} AND is_demo`;
    await audit(sql, { companyId: null, userId: user.id, action: 'delete_demo', entity: 'company', entityId: cid });
  });
  done('/', 'Demobolaget är borttaget');
}
