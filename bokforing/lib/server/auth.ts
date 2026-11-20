import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { sql } from '@/lib/db';
import { access, billingEnforced, type Access } from '@/lib/billing';
import { canView, hasPermission, PERMISSIONS, type Permission } from '@/lib/permissions';
import { cache } from 'react';
import { ipAllowed } from '@/lib/sso';

const COOKIE = 'bok_session';
const SESSION_DAYS = 14;

export type Role = 'owner' | 'accountant' | 'employee' | 'auditor';
export interface User { id: number; email: string; name: string }
export interface Company {
  id: number; name: string; orgnr: string; company_type: 'AB' | 'EF' | 'HB' | 'KB'; vat_period: 'month' | 'quarter' | 'year';
  address: string; postal_code: string; city: string; email: string; phone: string; vat_number: string;
  bankgiro: string; plusgiro: string; iban: string; require_mfa: boolean; ip_allowlist: string[]; f_skatt: boolean; invoice_terms: number; late_interest: string;
  locked_until: string | null; next_invoice_no: number; attest_threshold: number | null; attest_not_registrant: boolean;
  accounting_method: 'invoice' | 'cash'; prelskatt_from: string | null; bic: string; swish_number: string; swish_commerce: boolean; auto_attest_matched: boolean; vacation_liability_auto: boolean; oss_registered: boolean; accept_intercompany: boolean; part_payment_max: number; part_payment_min: number;
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export async function hashPassword(pw: string) { return bcrypt.hash(pw, 12); }
export async function verifyPassword(pw: string, hash: string) { return bcrypt.compare(pw, hash); }

/** Klientens IP för åtkomstregler: Vercels egna rubriker först (de kan inte sättas av klienten), annars proxyns */
export async function policyIp(): Promise<string> {
  const h = await headers();
  return (h.get('x-vercel-forwarded-for') ?? h.get('x-real-ip') ?? h.get('x-forwarded-for') ?? '').split(',')[0].trim();
}

export type LoginMethod = 'password' | 'totp' | 'passkey' | 'bankid' | 'sso' | 'register' | 'invite';

/** Loggar ett inloggningsförsök (lyckat eller misslyckat) */
export async function logLogin(o: { userId: number | null; email?: string; method: LoginMethod; success: boolean; reason?: string }) {
  const h = await headers();
  await sql`INSERT INTO login_events (user_id, email, method, success, reason, ip, user_agent)
    VALUES (${o.userId}, ${(o.email ?? '').slice(0, 200)}, ${o.method}, ${o.success}, ${o.reason ?? ''}, ${(await policyIp()) || null}, ${(h.get('user-agent') ?? '').slice(0, 400) || null})`.catch(() => {});
}

export async function createSession(userId: number, o: { method?: LoginMethod; mfa?: boolean; ssoCompanyId?: number } = {}) {
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  const h = await headers();
  const method = o.method ?? 'password';
  if (method === 'sso' && !o.ssoCompanyId) throw new Error('SSO-session utan bolag');
  await sql`INSERT INTO sessions (id, user_id, expires_at, method, mfa, ip, user_agent, sso_company_id)
    VALUES (${sha256(token)}, ${userId}, ${expires}, ${method}, ${!!o.mfa}, ${(await policyIp()) || null}, ${(h.get('user-agent') ?? '').slice(0, 400) || null}, ${o.ssoCompanyId ?? null})`;
  await logLogin({ userId, method, success: true });
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

export interface SessionInfo { id: string; user: User; method: string; mfa: boolean; ssoCompanyId: number | null }

/** Den inloggade sessionen (en gång per anrop). Senast aktiv uppdateras högst var femte minut. */
export const currentSession = cache(async (): Promise<SessionInfo | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const id = sha256(token);
  const rows = await sql<(User & { method: string; mfa: boolean; stale: boolean; sso_company_id: number | null })[]>`
    SELECT u.id, u.email, u.name, s.method, s.mfa, s.sso_company_id, s.last_seen_at < now() - interval '5 minutes' AS stale FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ${id} AND s.expires_at > now()`;
  const r = rows[0];
  if (!r) return null;
  if (r.stale) await sql`UPDATE sessions SET last_seen_at = now() WHERE id = ${id}`.catch(() => {});
  return { id, user: { id: r.id, email: r.email, name: r.name }, method: r.method, mfa: r.mfa, ssoCompanyId: r.sso_company_id };
});

/**
 * Inloggad användare för sidor utanför ett bolag (konto, byrå, koncern, appar). En SSO-session gäller bara bolaget
 * vars identitetsleverantör utfärdade den – bolagets ägare väljer leverantören och kan därför inte ge åtkomst till något annat.
 */
export const currentUser = async (): Promise<User | null> => { const s = await currentSession(); return s && s.method !== 'sso' ? s.user : null; };

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) redirect('/login');
  return u;
}

/**
 * Bolagets åtkomstregler för den här sessionen: utloggad av ägaren, IP-begränsning, krav på SSO för bolagets domäner
 * och krav på tvåstegsverifiering. Gäller alla roller, även redovisningsbyråns konsulter.
 */
/** Varför sessionen inte får använda bolaget just nu (null = tillåten) */
export async function companyPolicyBlock(companyId: number, s: SessionInfo, c?: { require_mfa: boolean; ip_allowlist: string[] }): Promise<{ msg: string; mfa?: boolean } | null> {
  if (!c) [c] = await sql<{ require_mfa: boolean; ip_allowlist: string[] }[]>`SELECT require_mfa, ip_allowlist FROM companies WHERE id = ${companyId}`;
  if (!c) return { msg: 'Bolaget finns inte' };
  if (s.method === 'sso' && s.ssoCompanyId !== companyId) return { msg: 'Företagsinloggningen gäller bara bolaget som den gjordes för. Logga ut och logga in igen för att öppna ett annat bolag.' };
  const user = s.user;
  const [r] = await sql<{ blocked: boolean; sso: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM session_company_blocks WHERE session_id = ${s.id} AND company_id = ${companyId}) AS blocked,
      EXISTS (SELECT 1 FROM company_sso WHERE company_id = ${companyId} AND enabled AND enforce AND ${user.email.split('@')[1]?.toLowerCase() ?? ''} = ANY(domains)) AS sso`;
  if (r.blocked) return { msg: 'Du har loggats ut från bolaget. Logga in igen för att fortsätta.' };
  if (c.ip_allowlist?.length && !ipAllowed(await policyIp(), c.ip_allowlist)) return { msg: 'Bolaget tillåter bara inloggning från vissa nätverk – din anslutning finns inte med.' };
  if (r.sso && s.method !== 'sso') return { msg: 'Bolaget kräver att du loggar in med företagets inloggning (SSO). Logga ut och välj "Logga in med SSO".' };
  if (c.require_mfa && !s.mfa) return { msg: 'Bolaget kräver tvåstegsverifiering. Slå på den här (eller använd en passkey/BankID) och logga in igen.', mfa: true };
  return null;
}

/** Bolagen i listan som sessionen får använda (för sidor som visar flera bolag: koncern, nyckeltal, byråvy, appar) */
export async function allowedCompanies<T extends { id: number }>(rows: T[]): Promise<T[]> {
  const s = await currentSession();
  if (!s) return [];
  const out: T[] = [];
  for (const r of rows) if (!(await companyPolicyBlock(r.id, s))) out.push(r);
  return out;
}

async function enforceCompanyAccess(companyId: number, c: { require_mfa: boolean; ip_allowlist: string[] }) {
  const s = await currentSession();
  if (!s) redirect('/login');
  const b = await companyPolicyBlock(companyId, s, c);
  if (!b) return;
  if (b.mfa && s.method !== 'sso') redirect(`/konto?error=${encodeURIComponent(b.msg)}#tvasteg`);
  redirect(`/?error=${encodeURIComponent(b.msg)}`);
}

export interface Ctx { user: User; company: Company; role: Role; billing: Access; employeeId: number | null; permissions: Permission[] | null; can: (p: Permission) => boolean; aiAccess: boolean }

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
  // SSO-sessioner släpps in här; companyPolicyBlock begränsar dem till sitt eget bolag
  const session = await currentSession();
  if (!session) redirect('/login');
  const user = session.user;
  const id = Number(companyId);
  if (!Number.isInteger(id)) notFound();
  // Medlemskap i bolaget, eller åtkomst via en redovisningsbyrå som bolaget har gett behörighet (roll redovisningskonsult)
  const rows = await sql<(Company & { role: Role; employee_id: number | null; permissions: Permission[] | null; ai_access: boolean | null })[]>`
    SELECT c.*, to_char(c.locked_until, 'YYYY-MM-DD') AS locked_until,
      COALESCE((SELECT m.role FROM memberships m WHERE m.company_id = c.id AND m.user_id = ${user.id}),
        (SELECT 'accountant' FROM firm_clients fc JOIN firm_members fm ON fm.firm_id = fc.firm_id WHERE fc.company_id = c.id AND fm.user_id = ${user.id} LIMIT 1)) AS role,
      (SELECT e.id FROM employees e WHERE e.company_id = c.id AND e.user_id = ${user.id} LIMIT 1) AS employee_id,
      (SELECT m.permissions FROM memberships m WHERE m.company_id = c.id AND m.user_id = ${user.id}) AS permissions,
      (SELECT m.ai_access FROM memberships m WHERE m.company_id = c.id AND m.user_id = ${user.id}) AS ai_access
    FROM companies c WHERE c.id = ${id}`;
  const row = rows[0];
  if (!row || !row.role) notFound();
  const { role, employee_id, permissions, ai_access, ...company } = row;
  await enforceCompanyAccess(id, row as unknown as { require_mfa: boolean; ip_allowlist: string[] });
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
  // AI-funktioner (kostar per anrop): ägaren alltid, andra användare bara om ägaren har gett dem tillgång
  const aiAccess = role === 'owner' || (!!ai_access && role !== 'auditor' && role !== 'employee');
  return { user, company: company as Company, role, billing, employeeId: employee_id, permissions, can: (p: Permission) => hasPermission(role, permissions, p), aiAccess };
}
