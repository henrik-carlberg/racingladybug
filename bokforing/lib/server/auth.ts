import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { sql } from '@/lib/db';
import { access, billingEnforced, type Access } from '@/lib/billing';
import { canView, hasPermission, PERMISSIONS, type Permission } from '@/lib/permissions';

const COOKIE = 'bok_session';
const SESSION_DAYS = 14;

export type Role = 'owner' | 'accountant' | 'employee' | 'auditor';
export interface User { id: number; email: string; name: string }
export interface Company {
  id: number; name: string; orgnr: string; company_type: 'AB' | 'EF'; vat_period: 'month' | 'quarter' | 'year';
  address: string; postal_code: string; city: string; email: string; phone: string; vat_number: string;
  bankgiro: string; plusgiro: string; iban: string; f_skatt: boolean; invoice_terms: number; late_interest: string;
  locked_until: string | null; next_invoice_no: number; attest_threshold: number | null; attest_not_registrant: boolean;
  accounting_method: 'invoice' | 'cash'; prelskatt_from: string | null; bic: string; swish_number: string; swish_commerce: boolean; part_payment_max: number; part_payment_min: number;
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
  // Gränssnittets språk följer användaren
  const [u] = await sql<{ locale: string }[]>`SELECT locale FROM users WHERE id = ${userId}`;
  await setLangCookie(u?.locale === 'en' ? 'en' : 'sv');
}

export async function setLangCookie(lang: 'sv' | 'en') {
  (await cookies()).set('ui_lang', lang, { sameSite: 'lax', path: '/', maxAge: 365 * 86400, secure: process.env.NODE_ENV === 'production' });
}

export async function destroySession() {
  const c = await cookies();
  const token = c.get(COOKIE)?.value;
  if (token) await sql`DELETE FROM sessions WHERE id = ${sha256(token)}`;
  c.delete(COOKIE);
}

/** Loggar ut användarens alla andra sessioner (t.ex. efter lösenordsbyte) */
export async function destroyOtherSessions(userId: number) {
  const token = (await cookies()).get(COOKIE)?.value;
  await sql`DELETE FROM sessions WHERE user_id = ${userId} AND id <> ${token ? sha256(token) : ''}`;
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

export interface Ctx { user: User; company: Company; role: Role; billing: Access; employeeId: number | null; permissions: Permission[] | null; can: (p: Permission) => boolean }

/** Åtkomst enligt abonnemanget (alltid öppet om betalning inte är påslagen) */
export async function companyAccess(companyId: number): Promise<Access> {
  const [r] = await sql<{ exempt: boolean; status: string | null; trial: string | null; period: string | null; created: string }[]>`
    SELECT c.billing_exempt AS exempt, s.status, to_char(s.trial_ends_at,'YYYY-MM-DD') AS trial, to_char(s.current_period_end,'YYYY-MM-DD') AS period,
      to_char(c.created_at + interval '30 days','YYYY-MM-DD') AS created
    FROM companies c LEFT JOIN subscriptions s ON s.company_id = c.id WHERE c.id = ${companyId}`;
  if (!r) return { state: 'locked' };
  const a = access({ exempt: r.exempt, status: r.status, trialEndsAt: r.trial ?? r.created, periodEnd: r.period, today: new Date().toISOString().slice(0, 10) });
  return billingEnforced() || a.state !== 'locked' ? a : { state: 'active' };
}

/**
 * Är anropet en ändring? Serveråtgärder skickas med fetch (header Next-Action) eller, utan JavaScript,
 * som vanligt formulär (multipart/urlencoded POST utan header). En sidvisning (GET) har varken header eller body.
 */
async function isMutation() {
  const h = await headers();
  return !!(h.get('next-action') || h.get('content-type') || (h.get('content-length') && h.get('content-length') !== '0'));
}

/** Nekad åtgärd: tillbaka till sidan man kom från, med felmeddelandet */
async function denyAction(companyId: number, msg: string): Promise<never> {
  const ref = (await headers()).get('referer');
  let back = `/c/${companyId}`;
  try { const u = new URL(ref ?? ''); if (u.pathname.startsWith(`/c/${companyId}`)) back = u.pathname; } catch { /* ingen referer */ }
  redirect(`${back}?error=${encodeURIComponent(msg)}`);
}

/**
 * Kräver inloggning och medlemskap i bolaget.
 * - owner: bara ägaren
 * - employee: sidan är öppen även för anställda (självservice); annars skickas de till Min sida
 * - allowLocked: sidan fungerar även när abonnemanget har gått ut (abonnemang, export)
 */
export async function requireCompany(companyId: number | string, opts: { owner?: boolean; employee?: boolean; allowLocked?: boolean; perm?: Permission; auditWork?: boolean } = {}): Promise<Ctx> {
  const user = await requireUser();
  const id = Number(companyId);
  if (!Number.isInteger(id)) notFound();
  // Medlemskap i bolaget, eller åtkomst via en redovisningsbyrå som bolaget har gett behörighet (roll redovisningskonsult)
  const rows = await sql<(Company & { role: Role; employee_id: number | null; permissions: Permission[] | null })[]>`
    SELECT c.*, to_char(c.locked_until, 'YYYY-MM-DD') AS locked_until,
      COALESCE((SELECT m.role FROM memberships m WHERE m.company_id = c.id AND m.user_id = ${user.id}),
        (SELECT 'accountant' FROM firm_clients fc JOIN firm_members fm ON fm.firm_id = fc.firm_id WHERE fc.company_id = c.id AND fm.user_id = ${user.id} LIMIT 1)) AS role,
      (SELECT e.id FROM employees e WHERE e.company_id = c.id AND e.user_id = ${user.id} LIMIT 1) AS employee_id,
      (SELECT m.permissions FROM memberships m WHERE m.company_id = c.id AND m.user_id = ${user.id}) AS permissions
    FROM companies c WHERE c.id = ${id}`;
  const row = rows[0];
  if (!row || !row.role) notFound();
  const { role, employee_id, permissions, ...company } = row;
  if (role === 'employee' && !opts.employee) redirect(`/c/${id}/mitt`);
  if (opts.owner && role !== 'owner') throw new Error('Endast ägare får göra detta');
  // Behörighet per användare: åtgärder kräver behörigheten, sidor kräver läsbehörighet
  if (opts.perm) {
    const isAction = await isMutation();
    const ok = isAction ? hasPermission(role, permissions, opts.perm) || role === 'auditor' : canView(role, permissions, opts.perm);
    if (!ok) {
      if (isAction) await denyAction(id, `Du saknar behörighet: ${PERMISSIONS[opts.perm]}`);
      redirect(`/c/${id}?error=${encodeURIComponent(`Du saknar behörighet: ${PERMISSIONS[opts.perm]}`)}`);
    }
  }
  // Revisorn får läsa allt men inte ändra något: alla serveråtgärder (formulär, knappar) nekas
  // Undantag: revisorns egen granskning (stickprov, kontrollpunkter) som inte ändrar bokföringen
  if (role === 'auditor' && !opts.auditWork && (await isMutation())) await denyAction(id, 'Revisorn har läsbehörighet och kan inte ändra i bokföringen');

  const billing = await companyAccess(id);
  if (billing.state === 'locked' && !opts.allowLocked) redirect(`/c/${id}/abonnemang`);
  return { user, company: company as Company, role, billing, employeeId: employee_id, permissions, can: (p: Permission) => hasPermission(role, permissions, p) };
}
