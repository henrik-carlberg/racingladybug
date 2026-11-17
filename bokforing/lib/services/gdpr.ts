import 'server-only';
import { randomBytes } from 'node:crypto';
import { sql } from '@/lib/db';
import { ConflictError, ValidationError } from '@/lib/errors';
import { audit, auditBy } from '@/lib/server/audit';
import { hashPassword, verifyPassword } from '@/lib/server/auth';
import { DPA_VERSION, RETENTION_YEARS } from '@/lib/legal';
import type { Actor } from './actor';

/** Registerutdrag (art. 15) och dataportabilitet (art. 20) för den inloggade användaren */
export async function exportUserData(userId: number) {
  const [user] = await sql`SELECT id, email, name, created_at, totp_enabled_at IS NOT NULL AS two_factor FROM users WHERE id = ${userId}`;
  const memberships = await sql`SELECT c.id AS company_id, c.name AS company, m.role, m.created_at FROM memberships m JOIN companies c ON c.id = m.company_id WHERE m.user_id = ${userId}`;
  const passkeys = await sql`SELECT name, device_type, created_at, last_used_at FROM passkeys WHERE user_id = ${userId}`;
  const sessions = await sql`SELECT expires_at FROM sessions WHERE user_id = ${userId}`;
  const employee = await sql`SELECT e.company_id, e.first_name, e.last_name, e.personal_number, e.email, e.address, e.postal_code, e.city, e.bank_clearing, e.bank_account,
    to_char(e.employment_start,'YYYY-MM-DD') AS employment_start, to_char(e.employment_end,'YYYY-MM-DD') AS employment_end, e.monthly_salary, e.vacation_days FROM employees e WHERE e.user_id = ${userId}`;
  const payslips = await sql`SELECT r.period, to_char(r.payment_date,'YYYY-MM-DD') AS payment_date, p.items, p.gross_cash, p.benefits, p.tax, p.net_pay
    FROM payslips p JOIN payroll_runs r ON r.id = p.run_id JOIN employees e ON e.id = p.employee_id WHERE e.user_id = ${userId} AND r.status <> 'draft' ORDER BY r.period`;
  const absences = await sql`SELECT a.kind, to_char(a.from_date,'YYYY-MM-DD') AS "from", to_char(a.to_date,'YYYY-MM-DD') AS "to", a.extent, a.status, a.note
    FROM absences a JOIN employees e ON e.id = a.employee_id WHERE e.user_id = ${userId}`;
  const time = await sql`SELECT to_char(date,'YYYY-MM-DD') AS date, minutes, description FROM time_entries WHERE user_id = ${userId} ORDER BY date`;
  const activity = await sql`SELECT created_at, company_id, action, entity, entity_id FROM audit_log WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 1000`;
  return { exported_at: new Date().toISOString(), user, memberships, passkeys, active_sessions: sessions.length, employee, payslips, absences, time_entries: time, activity_log: activity };
}

/** Radering av konto (art. 17). Uppgifter som ingår i bokföringen (vem som bokförde) måste sparas – användaren anonymiseras. */
export async function deleteAccount(userId: number, password: string, confirm: string) {
  const [u] = await sql<{ hash: string; email: string }[]>`SELECT password_hash AS hash, email FROM users WHERE id = ${userId}`;
  if (!(await verifyPassword(password, u.hash))) throw new ValidationError('Fel lösenord');
  if (confirm.trim().toLowerCase() !== 'radera') throw new ValidationError('Skriv RADERA för att bekräfta');
  const sole = await sql<{ name: string }[]>`
    SELECT c.name FROM memberships m JOIN companies c ON c.id = m.company_id WHERE m.user_id = ${userId} AND m.role = 'owner'
      AND NOT EXISTS (SELECT 1 FROM memberships o WHERE o.company_id = m.company_id AND o.role = 'owner' AND o.user_id <> ${userId})`;
  if (sole.length) throw new ConflictError(`Du är ensam ägare av ${sole.map((s) => s.name).join(', ')}. Bjud in en ny ägare först, eller exportera bokföringen (SIE) och avsluta bolaget. Bokföringen måste sparas i ${RETENTION_YEARS} år.`);
  await sql.begin(async (tx) => {
    await tx`DELETE FROM sessions WHERE user_id = ${userId}`;
    await tx`DELETE FROM passkeys WHERE user_id = ${userId}`;
    await tx`DELETE FROM mfa_challenges WHERE user_id = ${userId}`;
    await tx`DELETE FROM memberships WHERE user_id = ${userId}`;
    await tx`UPDATE employees SET user_id = NULL WHERE user_id = ${userId}`;
    await tx`UPDATE users SET email = ${`raderad-${userId}@invalid`}, name = 'Raderad användare', password_hash = ${await hashPassword(randomBytes(24).toString('hex'))},
      totp_secret = NULL, totp_enabled_at = NULL, backup_codes = '{}' WHERE id = ${userId}`;
    await audit(tx, { companyId: null, userId, action: 'delete_account', entity: 'user', entityId: userId });
  });
}

export async function acceptDpa(actor: Actor) {
  await sql`UPDATE companies SET dpa_accepted_at = now(), dpa_accepted_by = ${actor.userId} WHERE id = ${actor.companyId}`;
  await auditBy(sql, actor, 'accept_dpa', 'company', actor.companyId, { version: DPA_VERSION });
}

/** Sista dag för att räkna som gallringsbar: anställningen slutade före 1 januari för (i år − 7) */
export const pruneBefore = (year = new Date().getFullYear()) => `${year - RETENTION_YEARS}-01-01`;

export async function prunableEmployees(companyId: number) {
  return sql<{ id: number; name: string; ended: string }[]>`
    SELECT id, first_name || ' ' || last_name AS name, to_char(employment_end,'YYYY-MM-DD') AS ended FROM employees
    WHERE company_id = ${companyId} AND NOT active AND employment_end < ${pruneBefore()} AND personal_number NOT LIKE 'GALLRAD%' ORDER BY employment_end`;
}

/** Gallring: tar bort personuppgifter om anställda vars lagringstid har löpt ut. Lönebeloppen finns kvar utan koppling till personen. */
export async function pruneEmployees(actor: Actor) {
  const ids = (await prunableEmployees(actor.companyId)).map((e) => e.id);
  if (!ids.length) throw new ValidationError('Det finns inga anställda att gallra');
  await sql.begin(async (tx) => {
    await tx`UPDATE employees SET first_name = 'Gallrad', last_name = 'anställd ' || id, personal_number = 'GALLRAD-' || id, email = '', address = '', postal_code = '', city = '',
      bank_clearing = '', bank_account = '', user_id = NULL WHERE id IN ${tx(ids)} AND company_id = ${actor.companyId}`;
    await tx`DELETE FROM absences WHERE employee_id IN ${tx(ids)}`;
    await auditBy(tx, actor, 'prune_employees', 'company', actor.companyId, { count: ids.length });
  });
  return ids.length;
}
