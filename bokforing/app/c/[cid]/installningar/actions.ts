'use server';
import { sendMail } from '@/lib/server/mail';
import { requestOrigin } from '@/lib/server/origin';
import { sql } from '@/lib/db';
import { attempt, done, int, str } from '@/lib/server/action';
import { requireCompany, newToken, sha256 } from '@/lib/server/auth';
import { audit } from '@/lib/server/audit';
import { addDays } from '@/lib/format';
import { fiscalYearError } from '@/lib/fiscal';

const back = (cid: number) => `/c/${cid}/installningar`;

export async function updateCompany(cid: number, fd: FormData) {
  const { company, user } = await requireCompany(cid);
  await attempt(back(cid), async () => {
    const vat = ['month', 'quarter', 'year'].includes(str(fd, 'vat_period')) ? str(fd, 'vat_period') : 'quarter';
    const method = str(fd, 'accounting_method') === 'cash' ? 'cash' : 'invoice';
    const prelFrom = str(fd, 'prelskatt_from');
    if (prelFrom && !/^\d{4}-\d{2}$/.test(prelFrom)) throw new Error('Ange månad som ÅÅÅÅ-MM');
    await sql`UPDATE companies SET
      name = ${str(fd, 'name')}, address = ${str(fd, 'address')}, postal_code = ${str(fd, 'postal_code')}, city = ${str(fd, 'city')},
      email = ${str(fd, 'email')}, phone = ${str(fd, 'phone')}, vat_number = ${str(fd, 'vat_number')},
      bankgiro = ${str(fd, 'bankgiro')}, plusgiro = ${str(fd, 'plusgiro')}, iban = ${str(fd, 'iban')}, bic = ${str(fd, 'bic').toUpperCase()},
      swish_number = ${str(fd, 'swish_number').replace(/[^\d]/g, '')},
      f_skatt = ${fd.get('f_skatt') === 'on'}, invoice_terms = ${int(fd, 'invoice_terms') ?? 30},
      late_interest = ${str(fd, 'late_interest')}, vat_period = ${vat}, accounting_method = ${method}, prelskatt_from = ${prelFrom || null}
      WHERE id = ${company.id}`;
    await audit(sql, { companyId: company.id, userId: user.id, action: 'update', entity: 'company', entityId: company.id });
  });
  done(back(cid), 'Uppgifterna är sparade');
}

export async function addFiscalYear(cid: number, fd: FormData) {
  const { company, user } = await requireCompany(cid);
  await attempt(back(cid), async () => {
    const start = str(fd, 'start'), end = str(fd, 'end');
    const err = fiscalYearError(start, end, company.company_type);
    if (err) throw new Error(err);
    const overlap = await sql`SELECT 1 FROM fiscal_years WHERE company_id = ${company.id} AND start_date <= ${end} AND end_date >= ${start}`;
    if (overlap.length) throw new Error('Räkenskapsåret överlappar ett befintligt år');
    await sql`INSERT INTO fiscal_years (company_id, start_date, end_date) VALUES (${company.id}, ${start}, ${end})`;
    await audit(sql, { companyId: company.id, userId: user.id, action: 'create', entity: 'fiscal_year', details: { start, end } });
  });
  done(back(cid), 'Räkenskapsåret är tillagt');
}

/** Rätta ett öppet räkenskapsårs datum, t.ex. för att förlänga det första året. Alla verifikationer måste rymmas i de nya datumen. */
export async function updateFiscalYear(cid: number, fyId: number, fd: FormData) {
  const { company, user } = await requireCompany(cid, { owner: true });
  await attempt(back(cid), async () => {
    const start = str(fd, 'start'), end = str(fd, 'end');
    const err = fiscalYearError(start, end, company.company_type);
    if (err) throw new Error(err);
    await sql.begin(async (tx) => {
      const [fy] = await tx<{ start: string; end: string; closed: boolean }[]>`
        SELECT to_char(start_date,'YYYY-MM-DD') AS start, to_char(end_date,'YYYY-MM-DD') AS "end", closed FROM fiscal_years
        WHERE id = ${fyId} AND company_id = ${company.id} FOR UPDATE`;
      if (!fy) throw new Error('Räkenskapsåret finns inte');
      if (fy.closed) throw new Error('Ett stängt räkenskapsår kan inte ändras');
      const overlap = await tx`SELECT 1 FROM fiscal_years WHERE company_id = ${company.id} AND id <> ${fyId} AND start_date <= ${end} AND end_date >= ${start}`;
      if (overlap.length) throw new Error('De nya datumen överlappar ett annat räkenskapsår. Ta bort eller ändra det först.');
      const [outside] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM vouchers WHERE company_id = ${company.id}
        AND fiscal_year_id = ${fyId} AND source_type IS DISTINCT FROM 'opening_balance' AND (date < ${start} OR date > ${end})`;
      if (outside.n) throw new Error(`${outside.n} verifikationer ligger utanför de nya datumen`);
      await tx`UPDATE fiscal_years SET start_date = ${start}, end_date = ${end} WHERE id = ${fyId}`;
      // Ingående balanser dateras räkenskapsårets första dag
      await tx`UPDATE vouchers SET date = ${start} WHERE company_id = ${company.id} AND fiscal_year_id = ${fyId} AND source_type = 'opening_balance'`;
      await audit(tx, { companyId: company.id, userId: user.id, action: 'update', entity: 'fiscal_year', entityId: fyId, details: { from: fy, start, end } });
    });
  });
  done(back(cid), 'Räkenskapsåret är ändrat');
}

/** Ta bort ett tomt räkenskapsår som inte har några verifikationer */
export async function deleteFiscalYear(cid: number, fyId: number) {
  const { company, user } = await requireCompany(cid, { owner: true });
  await attempt(back(cid), async () => {
    await sql.begin(async (tx) => {
      const [fy] = await tx<{ start: string; end: string; closed: boolean }[]>`
        SELECT to_char(start_date,'YYYY-MM-DD') AS start, to_char(end_date,'YYYY-MM-DD') AS "end", closed FROM fiscal_years
        WHERE id = ${fyId} AND company_id = ${company.id} FOR UPDATE`;
      if (!fy) throw new Error('Räkenskapsåret finns inte');
      const [n] = await tx<{ n: number; total: number }[]>`SELECT
        (SELECT count(*) FROM vouchers WHERE company_id = ${company.id} AND fiscal_year_id = ${fyId})::int AS n,
        (SELECT count(*) FROM fiscal_years WHERE company_id = ${company.id})::int AS total`;
      if (n.n) throw new Error('Räkenskapsåret har verifikationer och kan inte tas bort');
      if (n.total <= 1) throw new Error('Bolaget måste ha minst ett räkenskapsår');
      await tx`DELETE FROM yearend_reports WHERE fiscal_year_id = ${fyId}`;
      await tx`DELETE FROM fiscal_years WHERE id = ${fyId}`;
      await audit(tx, { companyId: company.id, userId: user.id, action: 'delete', entity: 'fiscal_year', entityId: fyId, details: fy });
    });
  });
  done(back(cid), 'Räkenskapsåret är borttaget');
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
    const r = str(fd, 'role');
    const role = r === 'owner' ? 'owner' : r === 'employee' ? 'employee' : 'accountant';
    let employeeId: number | null = null;
    if (role === 'employee') {
      employeeId = Number(str(fd, 'employee_id')) || null;
      const [e] = employeeId ? await sql<{ user_id: number | null }[]>`SELECT user_id FROM employees WHERE id = ${employeeId} AND company_id = ${company.id}` : [];
      if (!e) throw new Error('Välj vilken anställd inbjudan gäller');
      if (e.user_id) throw new Error('Den anställda har redan ett konto');
    }
    await sql`INSERT INTO invites (company_id, email, role, token_hash, created_by, expires_at, employee_id)
      VALUES (${company.id}, ${email}, ${role}, ${sha256(token)}, ${user.id}, ${addDays(new Date().toISOString().slice(0, 10), 7)}, ${employeeId})`;
    await audit(sql, { companyId: company.id, userId: user.id, action: 'invite', entity: 'membership', details: { email, role } });
    const link = `${await requestOrigin()}/invite/${token}`;
    await sendMail(email, `Inbjudan till ${company.name}`, `Hej!\n\n${user.name} har bjudit in dig till ${company.name} i bokföringen.\n\nSkapa ditt konto här (länken gäller i 7 dagar):\n${link}\n`);
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
