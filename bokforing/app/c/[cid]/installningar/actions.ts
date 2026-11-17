'use server';
import { sql } from '@/lib/db';
import { attempt, done, int, str } from '@/lib/server/action';
import { requireCompany, newToken, sha256 } from '@/lib/server/auth';
import { audit } from '@/lib/server/audit';
import { addDays } from '@/lib/format';

const back = (cid: number) => `/c/${cid}/installningar`;

export async function updateCompany(cid: number, fd: FormData) {
  const { company, user } = await requireCompany(cid);
  await attempt(back(cid), async () => {
    const vat = ['month', 'quarter', 'year'].includes(str(fd, 'vat_period')) ? str(fd, 'vat_period') : 'quarter';
    await sql`UPDATE companies SET
      name = ${str(fd, 'name')}, address = ${str(fd, 'address')}, postal_code = ${str(fd, 'postal_code')}, city = ${str(fd, 'city')},
      email = ${str(fd, 'email')}, phone = ${str(fd, 'phone')}, vat_number = ${str(fd, 'vat_number')},
      bankgiro = ${str(fd, 'bankgiro')}, plusgiro = ${str(fd, 'plusgiro')}, iban = ${str(fd, 'iban')},
      f_skatt = ${fd.get('f_skatt') === 'on'}, invoice_terms = ${int(fd, 'invoice_terms') ?? 30},
      late_interest = ${str(fd, 'late_interest')}, vat_period = ${vat}
      WHERE id = ${company.id}`;
    await audit(sql, { companyId: company.id, userId: user.id, action: 'update', entity: 'company', entityId: company.id });
  });
  done(back(cid), 'Uppgifterna är sparade');
}

export async function addFiscalYear(cid: number, fd: FormData) {
  const { company, user } = await requireCompany(cid);
  await attempt(back(cid), async () => {
    const start = str(fd, 'start'), end = str(fd, 'end');
    if (!start || !end || end <= start) throw new Error('Ange giltigt start- och slutdatum');
    const overlap = await sql`SELECT 1 FROM fiscal_years WHERE company_id = ${company.id} AND start_date <= ${end} AND end_date >= ${start}`;
    if (overlap.length) throw new Error('Räkenskapsåret överlappar ett befintligt år');
    const days = (Date.parse(end) - Date.parse(start)) / 86400_000;
    if (days > 548) throw new Error('Ett räkenskapsår får vara högst 18 månader');
    await sql`INSERT INTO fiscal_years (company_id, start_date, end_date) VALUES (${company.id}, ${start}, ${end})`;
    await audit(sql, { companyId: company.id, userId: user.id, action: 'create', entity: 'fiscal_year', details: { start, end } });
  });
  done(back(cid), 'Räkenskapsåret är tillagt');
}

export async function setFiscalYearClosed(cid: number, fyId: number, closed: boolean) {
  const { company, user } = await requireCompany(cid, { owner: !closed });
  await sql`UPDATE fiscal_years SET closed = ${closed} WHERE id = ${fyId} AND company_id = ${company.id}`;
  await audit(sql, { companyId: company.id, userId: user.id, action: closed ? 'close' : 'reopen', entity: 'fiscal_year', entityId: fyId });
  done(back(cid), closed ? 'Räkenskapsåret är stängt' : 'Räkenskapsåret är öppnat');
}

export async function setLock(cid: number, fd: FormData) {
  const { company, user, role } = await requireCompany(cid);
  await attempt(back(cid), async () => {
    const date = str(fd, 'locked_until') || null;
    // Att låsa upp (flytta låset bakåt) får bara ägaren göra
    const unlocking = company.locked_until && (!date || date < company.locked_until);
    if (unlocking && role !== 'owner') throw new Error('Endast ägaren kan låsa upp en låst period');
    await sql`UPDATE companies SET locked_until = ${date} WHERE id = ${company.id}`;
    await audit(sql, { companyId: company.id, userId: user.id, action: 'lock', entity: 'company', entityId: company.id, details: { locked_until: date } });
  });
  done(back(cid), 'Periodlåset är uppdaterat');
}

export async function invite(cid: number, fd: FormData) {
  const { company, user } = await requireCompany(cid, { owner: true });
  const token = newToken();
  await attempt(back(cid), async () => {
    const email = str(fd, 'email').toLowerCase();
    if (!email.includes('@')) throw new Error('Ange en e-postadress');
    const role = str(fd, 'role') === 'owner' ? 'owner' : 'accountant';
    await sql`INSERT INTO invites (company_id, email, role, token_hash, created_by, expires_at)
      VALUES (${company.id}, ${email}, ${role}, ${sha256(token)}, ${user.id}, ${addDays(new Date().toISOString().slice(0, 10), 7)})`;
    await audit(sql, { companyId: company.id, userId: user.id, action: 'invite', entity: 'membership', details: { email, role } });
  });
  done(`${back(cid)}?invite=${token}`);
}

export async function removeMember(cid: number, userId: number) {
  const { company, user } = await requireCompany(cid, { owner: true });
  await attempt(back(cid), async () => {
    if (userId === user.id) throw new Error('Du kan inte ta bort dig själv');
    await sql`DELETE FROM memberships WHERE company_id = ${company.id} AND user_id = ${userId}`;
    await audit(sql, { companyId: company.id, userId: user.id, action: 'remove', entity: 'membership', entityId: userId });
  });
  done(back(cid), 'Användaren har tagits bort från bolaget');
}

export async function revokeInvite(cid: number, inviteId: number) {
  const { company } = await requireCompany(cid, { owner: true });
  await sql`DELETE FROM invites WHERE id = ${inviteId} AND company_id = ${company.id} AND accepted_at IS NULL`;
  done(back(cid), 'Inbjudan är återkallad');
}
