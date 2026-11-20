import 'server-only';
import { randomBytes, createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { currentSession, policyIp } from '@/lib/server/auth';
import { decrypt, encrypt } from '@/lib/server/crypto';
import { s256, verifyIdToken } from '@/lib/bankid';
import { amrHasMfa, isPrivateIp, deviceLabel, domainAllowed, domainOf, emailFrom, ipAllowed, issuerFor, parseCidrs, parseDomains, type SsoProvider } from '@/lib/sso';
import type { Actor } from './actor';
import { str } from './input';

const insecure = () => process.env.SSO_ALLOW_INSECURE === '1';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const on = (v: unknown) => v === 'on' || v === true || v === 'true';

// ---------- OIDC ----------
interface Discovery { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string }
const disc = new Map<string, { at: number; d: Discovery; jwks: { keys: never[] } }>();

/** Alla anrop till leverantören (även adresser ur dess konfiguration) ska gå till publika adresser över https */
async function assertPublic(url: string) {
  const u = new URL(url);
  if (u.protocol !== 'https:' && !(insecure() && u.protocol === 'http:')) throw new ValidationError('Identitetsleverantören måste använda https');
  if (insecure()) return;
  const addrs = await lookup(u.hostname.replace(/^\[|\]$/g, ''), { all: true }).catch(() => []);
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new ValidationError('Identitetsleverantören gick inte att nå');
}

async function getJson<T>(url: string): Promise<T> {
  await assertPublic(url);
  const r = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: 'error' }).catch(() => null);
  if (!r?.ok) throw new ValidationError('Identitetsleverantören gick inte att nå');
  return r.json() as Promise<T>;
}

async function discovery(issuer: string, force = false) {
  const c = disc.get(issuer);
  if (c && !force && Date.now() - c.at < 3600_000) return c;
  const d = await getJson<Discovery>(`${issuer}/.well-known/openid-configuration`);
  // Microsofts multi-tenant-dokument har {tenantid} i issuer; den katalogspecifika adressen ger rätt värde
  if (d.issuer !== issuer) throw new ValidationError('Utfärdaren i leverantörens konfiguration stämmer inte');
  for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
    let u: URL;
    try { u = new URL(d[k]); } catch { throw new ValidationError('Leverantörens konfiguration är ogiltig'); }
    if (u.protocol !== 'https:' && !(insecure() && u.protocol === 'http:')) throw new ValidationError('Leverantörens adresser måste använda https');
  }
  const v = { at: Date.now(), d, jwks: await getJson<{ keys: never[] }>(d.jwks_uri) };
  disc.set(issuer, v);
  return v;
}

// ---------- Inställningar (ägaren) ----------
export async function ssoConfig(companyId: number) {
  const [c] = await sql<{ provider: SsoProvider; issuer: string; client_id: string; domains: string[]; enforce: boolean; idp_mfa: boolean; enabled: boolean }[]>`
    SELECT provider, issuer, client_id, domains, enforce, idp_mfa, enabled FROM company_sso WHERE company_id = ${companyId}`;
  return c ?? null;
}

export async function saveSso(actor: Actor, input: Record<string, unknown>) {
  const provider = (['entra', 'google', 'oidc'].includes(str(input, 'provider')) ? str(input, 'provider') : 'oidc') as SsoProvider;
  let issuer: string, domains: string[];
  try {
    issuer = issuerFor(provider, str(input, provider === 'entra' ? 'tenant' : 'issuer', { max: 300 }), insecure());
    domains = parseDomains(str(input, 'domains', { max: 1000 }));
  } catch (e) { throw new ValidationError((e as Error).message); }
  if (!domains.length) throw new ValidationError('Ange minst en e-postdomän');
  const clientId = str(input, 'client_id', { required: true, label: 'Klient-id (client ID)', max: 300 });
  const secret = str(input, 'client_secret', { max: 1000 });
  const existing = await ssoConfig(actor.companyId);
  if (!secret && !existing) throw new ValidationError('Ange klienthemligheten (client secret)');
  const enforce = on(input.enforce);
  if (enforce) {
    const s = await currentSession();
    const [u] = await sql<{ email: string }[]>`SELECT email FROM users WHERE id = ${actor.userId}`;
    if (domains.includes(domainOf(u.email)) && s?.method !== 'sso') throw new ValidationError('Logga in med SSO en gång innan du kräver SSO – annars stänger du ute dig själv');
  }
  await discovery(issuer, true);
  const row = { provider, issuer, client_id: clientId, domains, enforce, idp_mfa: on(input.idp_mfa), enabled: true, updated_at: new Date() };
  if (existing) await sql`UPDATE company_sso SET ${sql(secret ? { ...row, client_secret: encrypt(secret) } : row)} WHERE company_id = ${actor.companyId}`;
  else await sql`INSERT INTO company_sso ${sql({ ...row, company_id: actor.companyId, client_secret: encrypt(secret) })}`;
  await auditBy(sql, actor, 'sso', 'company', actor.companyId, { provider, issuer, domains, enforce });
}

export async function removeSso(actor: Actor) {
  await sql`DELETE FROM company_sso WHERE company_id = ${actor.companyId}`;
  await auditBy(sql, actor, 'sso_remove', 'company', actor.companyId);
}

export async function setRequireMfa(actor: Actor, value: boolean) {
  if (value && !(await currentSession())?.mfa) throw new ValidationError('Logga in med tvåstegsverifiering, passkey eller BankID innan du kräver det av alla');
  await sql`UPDATE companies SET require_mfa = ${value} WHERE id = ${actor.companyId}`;
  await auditBy(sql, actor, value ? 'require_mfa' : 'allow_no_mfa', 'company', actor.companyId);
}

export async function setIpAllowlist(actor: Actor, input: Record<string, unknown>) {
  let list: string[];
  try { list = parseCidrs(str(input, 'ip_allowlist', { max: 5000 })); } catch (e) { throw new ValidationError((e as Error).message); }
  if (list.length > 50) throw new ValidationError('Högst 50 adresser eller nät');
  const ip = await policyIp();
  if (list.length && !ipAllowed(ip, list)) throw new ValidationError(`Din nuvarande adress (${ip || 'okänd'}) finns inte med – lägg till den så att du inte stänger ute dig själv`);
  await sql`UPDATE companies SET ip_allowlist = ${list} WHERE id = ${actor.companyId}`;
  await auditBy(sql, actor, 'ip_allowlist', 'company', actor.companyId, { list });
}

// ---------- Sessioner och logg ----------
const memberIds = (companyId: number) => sql`SELECT user_id FROM memberships WHERE company_id = ${companyId}
  UNION SELECT fm.user_id FROM firm_clients fc JOIN firm_members fm ON fm.firm_id = fc.firm_id WHERE fc.company_id = ${companyId}`;

export async function memberSessions(companyId: number) {
  const me = await currentSession();
  const rows = await sql<{ id: string; name: string; email: string; method: string; mfa: boolean; created_at: string; last_seen_at: string; ip: string | null; user_agent: string | null; blocked: boolean }[]>`
    SELECT s.id, u.name, u.email, s.method, s.mfa, to_char(s.created_at,'YYYY-MM-DD HH24:MI') AS created_at, to_char(s.last_seen_at,'YYYY-MM-DD HH24:MI') AS last_seen_at, s.ip, s.user_agent,
      EXISTS (SELECT 1 FROM session_company_blocks b WHERE b.session_id = s.id AND b.company_id = ${companyId}) AS blocked
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.expires_at > now() AND s.user_id IN (SELECT user_id FROM memberships WHERE company_id = ${companyId})
      AND (s.sso_company_id IS NULL OR s.sso_company_id = ${companyId}) ORDER BY s.last_seen_at DESC LIMIT 200`;
  // Sessionens id visas aldrig – bara en kort referens som inte kan användas för att logga in
  return rows.map(({ id, user_agent, ...r }) => ({ ...r, ref: id.slice(0, 12), device: deviceLabel(user_agent), current: id === me?.id }));
}

/** Ägaren loggar ut en session från bolaget (sessionen fungerar fortsatt för personens andra bolag) */
export async function blockSession(actor: Actor, ref: string) {
  if (!/^[0-9a-f]{12}$/.test(ref)) throw new ValidationError('Ogiltig session');
  const me = await currentSession();
  const [s] = await sql<{ id: string; user_id: number }[]>`SELECT id, user_id FROM sessions WHERE left(id, 12) = ${ref} AND expires_at > now() AND user_id IN (${memberIds(actor.companyId)})`;
  if (!s) throw new NotFoundError('Sessionen');
  if (s.id === me?.id) throw new ConflictError('Du kan inte logga ut din egen session här – använd Logga ut');
  await sql`INSERT INTO session_company_blocks (session_id, company_id, blocked_by) VALUES (${s.id}, ${actor.companyId}, ${actor.userId}) ON CONFLICT DO NOTHING`;
  await auditBy(sql, actor, 'block_session', 'user', s.user_id);
}

export async function companyLoginLog(companyId: number) {
  return sql<{ at: string; name: string | null; email: string; method: string; success: boolean; reason: string; ip: string | null; user_agent: string | null }[]>`
    SELECT to_char(e.at,'YYYY-MM-DD HH24:MI') AS at, u.name, COALESCE(u.email, e.email) AS email, e.method, e.success, e.reason, e.ip, e.user_agent
    FROM login_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.user_id IN (SELECT user_id FROM memberships WHERE company_id = ${companyId}) ORDER BY e.at DESC LIMIT 200`;
}

export async function mySessions(userId: number) {
  const me = await currentSession();
  const rows = await sql<{ id: string; method: string; mfa: boolean; created_at: string; last_seen_at: string; ip: string | null; user_agent: string | null }[]>`
    SELECT id, method, mfa, to_char(created_at,'YYYY-MM-DD HH24:MI') AS created_at, to_char(last_seen_at,'YYYY-MM-DD HH24:MI') AS last_seen_at, ip, user_agent
    FROM sessions WHERE user_id = ${userId} AND expires_at > now() ORDER BY last_seen_at DESC`;
  return rows.map(({ id, user_agent, ...r }) => ({ ...r, ref: id.slice(0, 12), device: deviceLabel(user_agent), current: id === me?.id }));
}

export async function endMySession(userId: number, ref: string) {
  if (!/^[0-9a-f]{12}$/.test(ref)) throw new ValidationError('Ogiltig session');
  const me = await currentSession();
  const r = await sql`DELETE FROM sessions WHERE user_id = ${userId} AND left(id, 12) = ${ref} AND id <> ${me?.id ?? ''} RETURNING id`;
  if (!r.length) throw new NotFoundError('Sessionen');
}

export async function myLoginLog(userId: number) {
  return sql<{ at: string; method: string; success: boolean; reason: string; ip: string | null; user_agent: string | null }[]>`
    SELECT to_char(at,'YYYY-MM-DD HH24:MI') AS at, method, success, reason, ip, user_agent FROM login_events WHERE user_id = ${userId} ORDER BY at DESC LIMIT 50`;
}

// ---------- SSO-inloggning ----------
/** Startar inloggning hos bolagets identitetsleverantör. Bara konton som redan är medlemmar i ett bolag med domänen kan logga in. */
export async function ssoStart(origin: string, emailRaw: string) {
  const email = emailRaw.trim().toLowerCase();
  const d = domainOf(email);
  const fail = new ValidationError('Det finns ingen företagsinloggning för e-postadressen');
  if (!d) throw fail;
  const [c] = await sql<{ company_id: number; issuer: string; client_id: string }[]>`
    SELECT s.company_id, s.issuer, s.client_id FROM company_sso s JOIN memberships m ON m.company_id = s.company_id JOIN users u ON u.id = m.user_id
    WHERE s.enabled AND ${d} = ANY(s.domains) AND u.email = ${email} ORDER BY s.company_id LIMIT 1`;
  if (!c) throw fail;
  const { d: dd } = await discovery(c.issuer);
  const state = randomBytes(24).toString('base64url'), nonce = randomBytes(16).toString('base64url'), verifier = randomBytes(32).toString('base64url');
  await sql`DELETE FROM sso_flows WHERE created_at < now() - interval '15 minutes'`;
  await sql`INSERT INTO sso_flows (state_hash, company_id, nonce, verifier, email) VALUES (${sha(state)}, ${c.company_id}, ${nonce}, ${verifier}, ${email})`;
  const q = new URLSearchParams({ response_type: 'code', client_id: c.client_id, redirect_uri: `${origin}/api/sso/callback`, scope: 'openid email profile', state, nonce,
    code_challenge: s256(verifier), code_challenge_method: 'S256', login_hint: email });
  return { url: `${dd.authorization_endpoint}?${q}`, state };
}

export async function ssoComplete(origin: string, state: string, cookieState: string | undefined, code: string) {
  if (!state || !cookieState || state !== cookieState) throw new ValidationError('Inloggningen startades inte i den här webbläsaren – försök igen');
  const [f] = await sql<{ company_id: number; nonce: string; verifier: string; email: string }[]>`
    DELETE FROM sso_flows WHERE state_hash = ${sha(state)} AND created_at > now() - interval '15 minutes' RETURNING company_id, nonce, verifier, email`;
  if (!f) throw new ValidationError('Inloggningen har gått ut – försök igen');
  const [c] = await sql<{ provider: SsoProvider; issuer: string; client_id: string; client_secret: string; domains: string[]; idp_mfa: boolean }[]>`
    SELECT provider, issuer, client_id, client_secret, domains, idp_mfa FROM company_sso WHERE company_id = ${f.company_id} AND enabled`;
  if (!c) throw new ValidationError('Företagsinloggningen är avstängd');
  const { d } = await discovery(c.issuer);
  await assertPublic(d.token_endpoint);
  const r = await fetch(d.token_endpoint, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${encodeURIComponent(c.client_id)}:${encodeURIComponent(decrypt(c.client_secret))}`).toString('base64')}` },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: `${origin}/api/sso/callback`, code_verifier: f.verifier }),
  });
  if (!r.ok) throw new ValidationError('Identitetsleverantören godkände inte inloggningen');
  const { id_token } = await r.json() as { id_token?: string };
  if (!id_token) throw new ValidationError('Svar utan id_token');
  let claims;
  try { claims = verifyIdToken(id_token, (await discovery(c.issuer)).jwks, { issuer: c.issuer, clientId: c.client_id, nonce: f.nonce }); }
  catch { claims = verifyIdToken(id_token, (await discovery(c.issuer, true)).jwks, { issuer: c.issuer, clientId: c.client_id, nonce: f.nonce }); }
  const email = emailFrom(claims, c.provider);
  if (!email || !domainAllowed(email, c.domains, claims, c.provider)) throw new ValidationError('Kontot hos identitetsleverantören hör inte till bolagets domän');
  const [u] = await sql<{ id: number }[]>`SELECT u.id FROM users u JOIN memberships m ON m.user_id = u.id AND m.company_id = ${f.company_id} WHERE u.email = ${email}`;
  if (!u) throw new ValidationError('Det finns inget konto med den e-postadressen i bolaget – be ägaren om en inbjudan');
  return { userId: u.id, email, mfa: c.idp_mfa || amrHasMfa(claims), companyId: f.company_id };
}
