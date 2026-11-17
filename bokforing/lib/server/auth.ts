import 'server-only';
import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { sql } from '@/lib/db';

const COOKIE = 'bok_session';
const SESSION_DAYS = 14;

export type Role = 'owner' | 'accountant';
export interface User { id: number; email: string; name: string }
export interface Company {
  id: number; name: string; orgnr: string; company_type: 'AB' | 'EF'; vat_period: 'month' | 'quarter' | 'year';
  address: string; postal_code: string; city: string; email: string; phone: string; vat_number: string;
  bankgiro: string; plusgiro: string; iban: string; f_skatt: boolean; invoice_terms: number; late_interest: string;
  locked_until: string | null; next_invoice_no: number;
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export async function hashPassword(pw: string) { return bcrypt.hash(pw, 12); }
export async function verifyPassword(pw: string, hash: string) { return bcrypt.compare(pw, hash); }

export async function createSession(userId: number) {
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await sql`INSERT INTO sessions (id, user_id, expires_at) VALUES (${sha256(token)}, ${userId}, ${expires})`;
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', expires });
}

export async function destroySession() {
  const c = await cookies();
  const token = c.get(COOKIE)?.value;
  if (token) await sql`DELETE FROM sessions WHERE id = ${sha256(token)}`;
  c.delete(COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const rows = await sql<User[]>`
    SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ${sha256(token)} AND s.expires_at > now()`;
  return rows[0] ?? null;
}

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) redirect('/login');
  return u;
}

export interface Ctx { user: User; company: Company; role: Role }

/** Kräver inloggning och medlemskap i bolaget. */
export async function requireCompany(companyId: number | string, opts: { owner?: boolean } = {}): Promise<Ctx> {
  const user = await requireUser();
  const id = Number(companyId);
  if (!Number.isInteger(id)) notFound();
  const rows = await sql<(Company & { role: Role })[]>`
    SELECT c.*, to_char(c.locked_until, 'YYYY-MM-DD') AS locked_until, m.role
    FROM companies c JOIN memberships m ON m.company_id = c.id
    WHERE c.id = ${id} AND m.user_id = ${user.id}`;
  const row = rows[0];
  if (!row) notFound();
  const { role, ...company } = row;
  if (opts.owner && role !== 'owner') throw new Error('Endast ägare får göra detta');
  return { user, company: company as Company, role };
}
