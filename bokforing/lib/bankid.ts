// BankID via OIDC: verifiering av id_token (JWT) och personnummer (ren logik, node:crypto)
import { createHash, createPublicKey, verify, type JsonWebKey } from 'node:crypto';

const b64 = (s: string) => Buffer.from(s, 'base64url');

export interface IdClaims { iss: string; aud: string | string[]; exp: number; iat?: number; nonce?: string; sub: string; name?: string; given_name?: string; family_name?: string; [k: string]: unknown }

/** Verifierar signatur (RS256/ES256), utfärdare, mottagare, giltighetstid och nonce. Kastar vid fel. */
export function verifyIdToken(token: string, jwks: { keys: (JsonWebKey & { kid?: string; alg?: string })[] }, o: { issuer: string; clientId: string; nonce: string; now?: number }): IdClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Ogiltig id_token');
  const header = JSON.parse(b64(parts[0]).toString()) as { alg: string; kid?: string };
  if (!['RS256', 'ES256'].includes(header.alg)) throw new Error(`Algoritmen stöds inte: ${header.alg}`);
  const jwk = jwks.keys.find((k) => (header.kid ? k.kid === header.kid : true) && (k.kty === (header.alg === 'RS256' ? 'RSA' : 'EC')));
  if (!jwk) throw new Error('Okänd signeringsnyckel');
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  const data = Buffer.from(`${parts[0]}.${parts[1]}`);
  const ok = header.alg === 'RS256' ? verify('RSA-SHA256', data, key, b64(parts[2])) : verify('SHA256', data, { key, dsaEncoding: 'ieee-p1363' }, b64(parts[2]));
  if (!ok) throw new Error('Ogiltig signatur på id_token');
  const c = JSON.parse(b64(parts[1]).toString()) as IdClaims;
  const now = o.now ?? Math.floor(Date.now() / 1000);
  if (c.iss !== o.issuer) throw new Error('Fel utfärdare');
  if (!(Array.isArray(c.aud) ? c.aud.includes(o.clientId) : c.aud === o.clientId)) throw new Error('Fel mottagare');
  if (typeof c.exp !== 'number' || c.exp < now - 60) throw new Error('id_token har gått ut');
  if (c.iat && c.iat > now + 300) throw new Error('id_token är utfärdad i framtiden');
  if (c.nonce !== o.nonce) throw new Error('Fel nonce');
  return c;
}

/** Personnumret ur claims (leverantörerna använder olika namn) som ÅÅÅÅMMDDNNNN */
export function personalNumberFrom(c: IdClaims, claim?: string): string | null {
  const keys = claim ? [claim] : ['ssn', 'personal_number', 'personalNumber', 'nin', 'socialno', 'signicat.national_id'];
  for (const k of keys) {
    const v = String(c[k] ?? '').replace(/\D/g, '');
    if (/^(19|20)\d{10}$/.test(v)) return v;
  }
  return null;
}

export const nameFrom = (c: IdClaims) => (c.name || [c.given_name, c.family_name].filter(Boolean).join(' ')).trim();
export const pnrHash = (pnr: string, secret: string) => createHash('sha256').update(`${secret}:${pnr}`).digest('hex');
export const maskPnr = (pnr: string) => `${pnr.slice(0, 8)}-****`;
export const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
