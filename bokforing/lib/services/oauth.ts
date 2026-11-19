import 'server-only';
import { randomBytes } from 'node:crypto';
import { sql } from '@/lib/db';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import { audit } from '@/lib/server/audit';
import { sha256 } from '@/lib/server/auth';
import { allScopes } from '@/lib/api/scopes';
import { ACCESS_TTL, CODE_TTL, canReceive, parseScopes, pkceOk, REFRESH_TTL, validRedirectUri } from '@/lib/oauth';
import type { Actor } from './actor';

export class OAuthError extends Error { constructor(public code: string, message: string, public status = 400) { super(message); } }
const known = () => new Set(allScopes().map((s) => s.scope));
const tok = (p: string) => `${p}_${randomBytes(32).toString('base64url')}`;

// ---------- Utvecklarens appar ----------
export async function createApp(userId: number, input: { name: string; description: string; homepage: string; redirect_uris: string; confidential: boolean }) {
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new ValidationError('Ge appen ett namn');
  const uris = [...new Set(input.redirect_uris.split(/\s+/).map((s) => s.trim()).filter(Boolean))];
  if (!uris.length || uris.length > 10) throw new ValidationError('Ange 1–10 återkomstadresser');
  const bad = uris.filter((u) => !validRedirectUri(u));
  if (bad.length) throw new ValidationError(`Återkomstadressen måste vara https (eller http://localhost): ${bad.join(', ')}`);
  if (input.homepage && !/^https:\/\/[^\s]+$/.test(input.homepage)) throw new ValidationError('Webbplatsen ska börja med https://');
  const clientId = `app_${randomBytes(9).toString('base64url')}`;
  const secret = input.confidential ? tok('appsec') : null;
  const [a] = await sql<{ id: number }[]>`INSERT INTO oauth_apps (client_id, secret_hash, name, description, homepage, redirect_uris, owner_user_id)
    VALUES (${clientId}, ${secret ? sha256(secret) : null}, ${name}, ${input.description.trim().slice(0, 500)}, ${input.homepage.trim()}, ${uris}, ${userId}) RETURNING id`;
  await audit(sql, { companyId: null, userId, action: 'create', entity: 'oauth_app', entityId: a.id, details: { name } });
  return { id: a.id, clientId, secret };
}
export async function myApps(userId: number) {
  return [...await sql<{ id: number; client_id: string; name: string; redirect_uris: string[]; confidential: boolean; companies: number; revoked: boolean }[]>`
    SELECT a.id, a.client_id, a.name, a.redirect_uris, a.secret_hash IS NOT NULL AS confidential, a.revoked_at IS NOT NULL AS revoked,
      (SELECT count(*)::int FROM oauth_grants g WHERE g.app_id = a.id AND g.revoked_at IS NULL) AS companies
    FROM oauth_apps a WHERE a.owner_user_id = ${userId} ORDER BY a.created_at DESC`];
}
export async function rotateSecret(userId: number, appId: number) {
  const secret = tok('appsec');
  const r = await sql`UPDATE oauth_apps SET secret_hash = ${sha256(secret)} WHERE id = ${appId} AND owner_user_id = ${userId} AND secret_hash IS NOT NULL AND revoked_at IS NULL RETURNING id`;
  if (!r.length) throw new NotFoundError('Appen');
  await audit(sql, { companyId: null, userId, action: 'rotate_secret', entity: 'oauth_app', entityId: appId });
  return secret;
}
/** Avregistrerar appen: alla bolags åtkomst och prenumerationer upphör */
export async function revokeApp(userId: number, appId: number) {
  const r = await sql`UPDATE oauth_apps SET revoked_at = now() WHERE id = ${appId} AND owner_user_id = ${userId} AND revoked_at IS NULL RETURNING id`;
  if (!r.length) throw new NotFoundError('Appen');
  for (const g of await sql<{ id: number }[]>`SELECT id FROM oauth_grants WHERE app_id = ${appId} AND revoked_at IS NULL`) await revokeGrantRow(g.id);
  await audit(sql, { companyId: null, userId, action: 'revoke', entity: 'oauth_app', entityId: appId });
}

// ---------- Samtycke ----------
export interface AuthRequest { app: { id: number; name: string; description: string; homepage: string }; scopes: string[]; redirectUri: string; state: string; challenge: string }
/** Kontrollerar en begäran till /oauth/authorize. Fel som inte kan skickas tillbaka (okänd app eller adress) visas på sidan. */
export async function checkAuthorize(q: URLSearchParams): Promise<AuthRequest> {
  const [a] = await sql<{ id: number; name: string; description: string; homepage: string; redirect_uris: string[] }[]>`
    SELECT id, name, description, homepage, redirect_uris FROM oauth_apps WHERE client_id = ${q.get('client_id') ?? ''} AND revoked_at IS NULL`;
  if (!a) throw new OAuthError('invalid_client', 'Okänd app');
  const redirectUri = q.get('redirect_uri') ?? '';
  if (!a.redirect_uris.includes(redirectUri)) throw new OAuthError('invalid_request', 'Återkomstadressen är inte registrerad för appen');
  if (q.get('response_type') !== 'code') throw new OAuthError('unsupported_response_type', 'Endast response_type=code stöds');
  if (q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(q.get('code_challenge') ?? '')) throw new OAuthError('invalid_request', 'PKCE med S256 krävs');
  let scopes: string[];
  try { scopes = parseScopes(q.get('scope') ?? '', known()); } catch (e) { throw new OAuthError('invalid_scope', (e as Error).message); }
  return { app: a, scopes, redirectUri, state: (q.get('state') ?? '').slice(0, 500), challenge: q.get('code_challenge')! };
}

/** Användaren godkänner för ett bolag där hen är ägare. Returnerar adressen att skicka webbläsaren till. */
export async function approve(userId: number, req: AuthRequest, companyId: number) {
  const [m] = await sql`SELECT 1 FROM memberships WHERE user_id = ${userId} AND company_id = ${companyId} AND role = 'owner'`;
  if (!m) throw new ForbiddenError('Bara bolagets ägare kan koppla appar');
  const code = tok('code');
  await sql`INSERT INTO oauth_codes (code_hash, app_id, user_id, company_id, scopes, redirect_uri, code_challenge, expires_at)
    VALUES (${sha256(code)}, ${req.app.id}, ${userId}, ${companyId}, ${req.scopes}, ${req.redirectUri}, ${req.challenge}, now() + ${CODE_TTL + ' seconds'}::interval)`;
  const u = new URL(req.redirectUri);
  u.searchParams.set('code', code);
  if (req.state) u.searchParams.set('state', req.state);
  return u.toString();
}
export function deny(req: AuthRequest) {
  const u = new URL(req.redirectUri);
  u.searchParams.set('error', 'access_denied');
  if (req.state) u.searchParams.set('state', req.state);
  return u.toString();
}

// ---------- Token-endpoint ----------
async function clientAuth(clientId: string, secret: string | null) {
  const [a] = await sql<{ id: number; secret_hash: string | null }[]>`SELECT id, secret_hash FROM oauth_apps WHERE client_id = ${clientId} AND revoked_at IS NULL`;
  if (!a) throw new OAuthError('invalid_client', 'Okänd app', 401);
  if (a.secret_hash && (!secret || sha256(secret) !== a.secret_hash)) throw new OAuthError('invalid_client', 'Fel klienthemlighet', 401);
  return a.id;
}
async function issue(grantId: number, scopes: string[]) {
  const access = tok('oat'), refresh = tok('ort');
  await sql`INSERT INTO oauth_tokens (token_hash, grant_id, kind, expires_at) VALUES
    (${sha256(access)}, ${grantId}, 'access', now() + ${ACCESS_TTL + ' seconds'}::interval), (${sha256(refresh)}, ${grantId}, 'refresh', now() + ${REFRESH_TTL + ' seconds'}::interval)`;
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL, refresh_token: refresh, scope: scopes.join(' ') };
}

export async function token(f: Record<string, string>, basic: { id: string; secret: string } | null) {
  const clientId = basic?.id ?? f.client_id ?? '', secret = basic?.secret ?? f.client_secret ?? null;
  const appId = await clientAuth(clientId, secret);
  if (f.grant_type === 'authorization_code') {
    // Koden kan bara användas en gång: markeras använd i samma uppdatering som den hämtas
    const [c] = await sql<{ user_id: number; company_id: number; scopes: string[]; redirect_uri: string; code_challenge: string }[]>`
      UPDATE oauth_codes SET used_at = now() WHERE code_hash = ${sha256(f.code ?? '')} AND app_id = ${appId} AND used_at IS NULL AND expires_at > now()
      RETURNING user_id, company_id, scopes, redirect_uri, code_challenge`;
    if (!c) throw new OAuthError('invalid_grant', 'Koden är ogiltig, använd eller har gått ut');
    if (c.redirect_uri !== f.redirect_uri) throw new OAuthError('invalid_grant', 'Återkomstadressen stämmer inte');
    if (!pkceOk(f.code_verifier ?? '', c.code_challenge)) throw new OAuthError('invalid_grant', 'PKCE-verifieringen misslyckades');
    const [m] = await sql`SELECT 1 FROM memberships WHERE user_id = ${c.user_id} AND company_id = ${c.company_id} AND role = 'owner'`;
    if (!m) throw new OAuthError('invalid_grant', 'Användaren är inte längre ägare i bolaget');
    // En aktiv koppling per app och bolag: en ny ersätter den gamla
    const [old] = await sql<{ id: number }[]>`SELECT id FROM oauth_grants WHERE app_id = ${appId} AND company_id = ${c.company_id} AND revoked_at IS NULL`;
    if (old) await revokeGrantRow(old.id);
    const [g] = await sql<{ id: number }[]>`INSERT INTO oauth_grants (app_id, company_id, user_id, scopes) VALUES (${appId}, ${c.company_id}, ${c.user_id}, ${c.scopes}) RETURNING id`;
    await audit(sql, { companyId: c.company_id, userId: c.user_id, action: 'connect_app', entity: 'oauth_grant', entityId: g.id, details: { app: appId, scopes: c.scopes } });
    return issue(g.id, c.scopes);
  }
  if (f.grant_type === 'refresh_token') {
    // Rotation: den gamla refresh-token slutar gälla när en ny lämnas ut
    const [t] = await sql<{ grant_id: number; scopes: string[] }[]>`UPDATE oauth_tokens t SET revoked_at = now() FROM oauth_grants g
      WHERE t.token_hash = ${sha256(f.refresh_token ?? '')} AND t.kind = 'refresh' AND t.revoked_at IS NULL AND t.expires_at > now()
        AND g.id = t.grant_id AND g.app_id = ${appId} AND g.revoked_at IS NULL RETURNING t.grant_id, g.scopes`;
    if (!t) throw new OAuthError('invalid_grant', 'Refresh-token är ogiltig');
    return issue(t.grant_id, t.scopes);
  }
  throw new OAuthError('unsupported_grant_type', 'grant_type ska vara authorization_code eller refresh_token');
}

/** RFC 7009: återkallar en token (och hela kopplingen om det är en refresh-token) */
export async function revokeToken(t: string, basic: { id: string; secret: string } | null, f: Record<string, string>) {
  const appId = await clientAuth(basic?.id ?? f.client_id ?? '', basic?.secret ?? f.client_secret ?? null);
  const [r] = await sql<{ grant_id: number; kind: string }[]>`SELECT t.grant_id, t.kind FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id WHERE t.token_hash = ${sha256(t)} AND g.app_id = ${appId}`;
  if (!r) return;
  if (r.kind === 'refresh') await revokeGrantRow(r.grant_id);
  else await sql`UPDATE oauth_tokens SET revoked_at = now() WHERE token_hash = ${sha256(t)}`;
}

async function revokeGrantRow(grantId: number) {
  await sql`UPDATE oauth_grants SET revoked_at = now() WHERE id = ${grantId} AND revoked_at IS NULL`;
  await sql`UPDATE oauth_tokens SET revoked_at = now() WHERE grant_id = ${grantId} AND revoked_at IS NULL`;
  await sql`DELETE FROM webhook_endpoints WHERE oauth_grant_id = ${grantId}`;
}

/** Bearer-token från en app → aktör. Användaren som godkände ska fortfarande vara ägare. */
export async function authenticateOAuth(t: string): Promise<{ actor: Actor; scopes: string[]; grantId: number } | null> {
  if (!t.startsWith('oat_')) return null;
  const [g] = await sql<{ id: number; company_id: number; user_id: number; scopes: string[] }[]>`
    SELECT g.id, g.company_id, g.user_id, g.scopes FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id JOIN oauth_apps a ON a.id = g.app_id
    JOIN memberships m ON m.user_id = g.user_id AND m.company_id = g.company_id AND m.role = 'owner'
    WHERE t.token_hash = ${sha256(t)} AND t.kind = 'access' AND t.revoked_at IS NULL AND t.expires_at > now() AND g.revoked_at IS NULL AND a.revoked_at IS NULL`;
  if (!g) return null;
  await sql`UPDATE oauth_grants SET last_used_at = now() WHERE id = ${g.id} AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`;
  return { actor: { companyId: g.company_id, userId: g.user_id, apiKeyId: null, role: 'api' }, scopes: g.scopes, grantId: g.id };
}

// ---------- Bolagets kopplade appar ----------
export async function connectedApps(companyId: number) {
  return [...await sql<{ id: number; app: string; homepage: string; scopes: string[]; by: string | null; created: string; last_used: string | null; calls: number; hooks: number }[]>`
    SELECT g.id, a.name AS app, a.homepage, g.scopes, u.name AS by, to_char(g.created_at,'YYYY-MM-DD') AS created, to_char(g.last_used_at,'YYYY-MM-DD HH24:MI') AS last_used,
      (SELECT count(*)::int FROM api_requests r WHERE r.oauth_grant_id = g.id AND r.created_at > now() - interval '30 days') AS calls,
      (SELECT count(*)::int FROM webhook_endpoints w WHERE w.oauth_grant_id = g.id) AS hooks
    FROM oauth_grants g JOIN oauth_apps a ON a.id = g.app_id LEFT JOIN users u ON u.id = g.user_id
    WHERE g.company_id = ${companyId} AND g.revoked_at IS NULL ORDER BY g.created_at DESC`];
}
export async function recentCalls(companyId: number) {
  return [...await sql<{ at: string; who: string; method: string; path: string; status: number }[]>`
    SELECT to_char(r.created_at,'YYYY-MM-DD HH24:MI:SS') AS at, COALESCE(a.name, k.name, '–') AS who, r.method, r.path, r.status
    FROM api_requests r LEFT JOIN oauth_grants g ON g.id = r.oauth_grant_id LEFT JOIN oauth_apps a ON a.id = g.app_id LEFT JOIN api_keys k ON k.id = r.api_key_id
    WHERE r.company_id = ${companyId} ORDER BY r.id DESC LIMIT 50`];
}
export async function disconnect(actor: Actor, grantId: number) {
  const [g] = await sql`SELECT 1 FROM oauth_grants WHERE id = ${grantId} AND company_id = ${actor.companyId} AND revoked_at IS NULL`;
  if (!g) throw new NotFoundError('Kopplingen');
  await revokeGrantRow(grantId);
  await audit(sql, { companyId: actor.companyId, userId: actor.userId, action: 'disconnect_app', entity: 'oauth_grant', entityId: grantId });
}

/** REST hooks (Zapier/Make): appen prenumererar på en händelse den har läsrätt till */
export async function subscribeHook(actor: Actor, grantId: number | null, scopes: string[], input: Record<string, unknown>) {
  const event = String(input.event ?? '');
  if (!canReceive(event, scopes)) throw new ValidationError(`Behörighet saknas för händelsen ${event}`);
  const { createWebhook } = await import('@/lib/server/integrations');
  const w = await createWebhook(actor, { url: String(input.target_url ?? ''), description: `REST hook (${event})`, events: [event] });
  if (grantId) await sql`UPDATE webhook_endpoints SET oauth_grant_id = ${grantId} WHERE id = ${w.id}`;
  return { id: w.id, object: 'hook', event, target_url: input.target_url, secret: w.secret };
}
export async function unsubscribeHook(actor: Actor, grantId: number | null, id: number) {
  const r = await sql`DELETE FROM webhook_endpoints WHERE id = ${id} AND company_id = ${actor.companyId} AND ${grantId ? sql`oauth_grant_id = ${grantId}` : sql`oauth_grant_id IS NULL AND description LIKE 'REST hook%'`} RETURNING id`;
  if (!r.length) throw new NotFoundError('Prenumerationen');
  return { id, object: 'hook', deleted: true };
}
