import 'server-only';
import { randomBytes, createHash } from 'node:crypto';
import { sql } from '@/lib/db';
import { ConflictError, ValidationError } from '@/lib/errors';
import { maskPnr, nameFrom, personalNumberFrom, pnrHash, s256, verifyIdToken, type IdClaims } from '@/lib/bankid';

const cfg = () => ({
  issuer: (process.env.BANKID_OIDC_ISSUER ?? '').replace(/\/$/, ''),
  clientId: process.env.BANKID_CLIENT_ID ?? '',
  secret: process.env.BANKID_CLIENT_SECRET ?? '',
  acr: process.env.BANKID_ACR_VALUES ?? 'urn:grn:authn:se:bankid',
  claim: process.env.BANKID_PNR_CLAIM || undefined,
});
export const bankidEnabled = () => { const c = cfg(); return !!(c.issuer && c.clientId && c.secret); };
const insecureOk = () => process.env.BANKID_ALLOW_INSECURE === '1';
const hashSecret = () => process.env.SESSION_SECRET || process.env.BANKID_CLIENT_SECRET || 'bankid';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

interface Discovery { authorization_endpoint: string; token_endpoint: string; jwks_uri: string; issuer: string }
let cache: { at: number; d: Discovery; jwks: { keys: never[] } } | null = null;

async function getJson<T>(url: string): Promise<T> {
  const u = new URL(url);
  if (u.protocol !== 'https:' && !(insecureOk() && u.protocol === 'http:')) throw new Error('BankID-leverantören måste använda https');
  const r = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!r.ok) throw new Error(`BankID-leverantören svarade ${r.status}`);
  return r.json() as Promise<T>;
}

async function discovery(force = false) {
  if (cache && !force && Date.now() - cache.at < 3600_000) return cache;
  const d = await getJson<Discovery>(`${cfg().issuer}/.well-known/openid-configuration`);
  cache = { at: Date.now(), d, jwks: await getJson(d.jwks_uri) };
  return cache;
}

export type Purpose = 'login' | 'link' | 'sign';

/** Startar en BankID-legitimering hos leverantören. Returnerar adressen att skicka webbläsaren till och state (sparas i en cookie). */
export async function startFlow(origin: string, o: { purpose: Purpose; userId?: number; signerId?: number; signToken?: string; back?: string; message?: string }) {
  if (!bankidEnabled()) throw new ValidationError('BankID är inte uppsatt');
  const { d } = await discovery();
  const state = randomBytes(24).toString('base64url'), nonce = randomBytes(16).toString('base64url'), verifier = randomBytes(32).toString('base64url');
  await sql`DELETE FROM bankid_flows WHERE created_at < now() - interval '15 minutes'`;
  await sql`INSERT INTO bankid_flows (state_hash, nonce, verifier, purpose, user_id, signer_id, sign_token, back)
    VALUES (${sha(state)}, ${nonce}, ${verifier}, ${o.purpose}, ${o.userId ?? null}, ${o.signerId ?? null}, ${o.signToken ?? null}, ${o.back?.startsWith('/') && !o.back.startsWith('//') ? o.back : '/'})`;
  const q = new URLSearchParams({
    response_type: 'code', client_id: cfg().clientId, redirect_uri: `${origin}/api/bankid/callback`, scope: 'openid', state, nonce,
    code_challenge: s256(verifier), code_challenge_method: 'S256', acr_values: cfg().acr,
    // Texten visas i BankID-appen vid signering (stöds av t.ex. Criipto)
    ...(o.message ? { login_hint: `message:${Buffer.from(o.message.slice(0, 900)).toString('base64')}` } : {}),
  });
  return { url: `${d.authorization_endpoint}?${q}`, state };
}

export interface Verified { pnr: string; name: string; claims: IdClaims; idTokenHash: string }

/** Tar emot svaret från leverantören: kontrollerar state (mot cookie), växlar koden mot id_token och verifierar den */
export async function completeFlow(origin: string, state: string, cookieState: string | undefined, code: string) {
  if (!state || !cookieState || state !== cookieState) throw new ValidationError('BankID-legitimeringen startades inte i den här webbläsaren – försök igen');
  const [f] = await sql<{ nonce: string; verifier: string; purpose: Purpose; user_id: number | null; signer_id: number | null; sign_token: string | null; back: string }[]>`
    DELETE FROM bankid_flows WHERE state_hash = ${sha(state)} AND created_at > now() - interval '15 minutes' RETURNING nonce, verifier, purpose, user_id, signer_id, sign_token, back`;
  if (!f) throw new ValidationError('BankID-legitimeringen har gått ut – försök igen');
  const c = cfg();
  const { d } = await discovery();
  const r = await fetch(d.token_endpoint, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${encodeURIComponent(c.clientId)}:${encodeURIComponent(c.secret)}`).toString('base64')}` },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: `${origin}/api/bankid/callback`, code_verifier: f.verifier }),
  });
  if (!r.ok) throw new ValidationError('BankID-leverantören godkände inte inloggningen');
  const { id_token } = await r.json() as { id_token?: string };
  if (!id_token) throw new ValidationError('Svar utan id_token');
  let claims: IdClaims;
  try { claims = verifyIdToken(id_token, (await discovery()).jwks, { issuer: d.issuer || c.issuer, clientId: c.clientId, nonce: f.nonce }); }
  catch { claims = verifyIdToken(id_token, (await discovery(true)).jwks, { issuer: d.issuer || c.issuer, clientId: c.clientId, nonce: f.nonce }); } // nycklarna kan ha bytts
  const pnr = personalNumberFrom(claims, c.claim);
  if (!pnr) throw new ValidationError('Personnummer saknas i svaret från BankID');
  return { flow: f, verified: { pnr, name: nameFrom(claims), claims, idTokenHash: sha(id_token) } as Verified };
}

export const userByPnr = async (pnr: string) => (await sql<{ id: number }[]>`SELECT id FROM users WHERE bankid_pnr_hash = ${pnrHash(pnr, hashSecret())}`)[0]?.id ?? null;

export async function linkBankId(userId: number, pnr: string) {
  const other = await userByPnr(pnr);
  if (other && other !== userId) throw new ConflictError('BankID med det personnumret är redan kopplat till ett annat konto');
  await sql`UPDATE users SET bankid_pnr_hash = ${pnrHash(pnr, hashSecret())}, bankid_linked_at = now() WHERE id = ${userId}`;
}
export async function unlinkBankId(userId: number) { await sql`UPDATE users SET bankid_pnr_hash = NULL, bankid_linked_at = NULL WHERE id = ${userId}`; }
/** Samma person som kontots kopplade BankID (konton utan kopplat BankID kan inte signera med BankID) */
export const samePerson = async (userId: number, pnr: string) => (await sql`SELECT 1 FROM users WHERE id = ${userId} AND bankid_pnr_hash = ${pnrHash(pnr, hashSecret())}`).length > 0;
export const hasBankId = async (userId: number) => (await sql`SELECT 1 FROM users WHERE id = ${userId} AND bankid_pnr_hash IS NOT NULL`).length > 0;
export { maskPnr };
