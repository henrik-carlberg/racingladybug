import 'server-only';
import { randomBytes } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type AuthenticatorTransportFuture, type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON, type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { sql } from '@/lib/db';
import { AppError, ValidationError } from '@/lib/errors';
import { audit } from './audit';
import type { User } from './auth';

const CHALLENGE_COOKIE = 'bok_webauthn';
const CHALLENGE_TTL_MS = 5 * 60_000;
const RP_NAME = 'Bokföring';

export class PasskeyError extends AppError {
  status = 400;
  code = 'passkey_error';
}

/**
 * Relying party = appens domän. Kan styras med WEBAUTHN_RP_ID och APP_ORIGIN (rekommenderas i produktion,
 * t.ex. RP_ID=bokforing.example.se). Annars härleds den från förfrågans host.
 * Obs! Passkeys är knutna till domänen – byter man domän måste användarna registrera nya.
 */
export async function relyingParty(): Promise<{ rpID: string; origin: string }> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const origin = process.env.APP_ORIGIN ?? `${proto}://${host}`;
  const rpID = process.env.WEBAUTHN_RP_ID ?? new URL(origin).hostname;
  return { rpID, origin };
}

async function storeChallenge(challenge: string, purpose: 'register' | 'login', userId: number | null) {
  const id = randomBytes(24).toString('base64url');
  await sql`DELETE FROM webauthn_challenges WHERE expires_at < now()`;
  await sql`INSERT INTO webauthn_challenges (id, challenge, purpose, user_id, expires_at)
    VALUES (${id}, ${challenge}, ${purpose}, ${userId}, ${new Date(Date.now() + CHALLENGE_TTL_MS)})`;
  (await cookies()).set(CHALLENGE_COOKIE, id, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: CHALLENGE_TTL_MS / 1000,
  });
}

/** Hämtar och förbrukar challengen (engångs). */
async function takeChallenge(purpose: 'register' | 'login', userId: number | null): Promise<string> {
  const c = await cookies();
  const id = c.get(CHALLENGE_COOKIE)?.value;
  c.delete(CHALLENGE_COOKIE);
  if (!id) throw new PasskeyError('Passkey-förfrågan saknas eller har gått ut. Försök igen.');
  const [row] = await sql<{ challenge: string }[]>`
    DELETE FROM webauthn_challenges WHERE id = ${id} AND purpose = ${purpose} AND expires_at > now()
      AND user_id IS NOT DISTINCT FROM ${userId}
    RETURNING challenge`;
  if (!row) throw new PasskeyError('Passkey-förfrågan har gått ut. Försök igen.');
  return row.challenge;
}

// ---------- Registrering (inloggad användare) ----------

export async function registrationOptions(user: User): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const { rpID } = await relyingParty();
  // Slumpat, stabilt användar-id för autentiseraren (skapas första gången)
  const [u] = await sql<{ webauthn_id: string }[]>`
    UPDATE users SET webauthn_id = COALESCE(webauthn_id, ${randomBytes(32).toString('base64url')}) WHERE id = ${user.id} RETURNING webauthn_id`;
  const existing = await sql<{ id: string; transports: string[] }[]>`SELECT id, transports FROM passkeys WHERE user_id = ${user.id}`;
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: user.email,
    userDisplayName: user.name,
    userID: Buffer.from(u.webauthn_id!, 'base64url'),
    attestationType: 'none',
    // Hindrar att samma autentiserare registreras två gånger
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports as AuthenticatorTransportFuture[] })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  await storeChallenge(options.challenge, 'register', user.id);
  return options;
}

export async function verifyRegistration(user: User, response: RegistrationResponseJSON, name: string) {
  const expectedChallenge = await takeChallenge('register', user.id);
  const { rpID, origin } = await relyingParty();
  let verification;
  try {
    verification = await verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
  } catch (e) {
    throw new PasskeyError(`Passkeyn kunde inte verifieras: ${e instanceof Error ? e.message : e}`);
  }
  if (!verification.verified || !verification.registrationInfo) throw new PasskeyError('Passkeyn kunde inte verifieras');
  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const label = name.trim().slice(0, 100) || (credentialDeviceType === 'multiDevice' ? 'Synkad passkey' : 'Säkerhetsnyckel');
  try {
    await sql`INSERT INTO passkeys (id, user_id, public_key, counter, transports, device_type, backed_up, name)
      VALUES (${credential.id}, ${user.id}, ${Buffer.from(credential.publicKey)}, ${credential.counter},
              ${credential.transports ?? []}, ${credentialDeviceType}, ${credentialBackedUp}, ${label})`;
  } catch (e) {
    if (String((e as Error).message).includes('passkeys_pkey')) throw new ValidationError('Den här passkeyn är redan registrerad');
    throw e;
  }
  await audit(sql, { companyId: null, userId: user.id, action: 'add', entity: 'passkey', details: { name: label } });
}

// ---------- Inloggning ----------

export async function authenticationOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const { rpID } = await relyingParty();
  // Tom allowCredentials = användaren väljer bland sina passkeys (discoverable credentials), ingen e-post behövs
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'required', allowCredentials: [] });
  await storeChallenge(options.challenge, 'login', null);
  return options;
}

/** Verifierar inloggningen och returnerar användarens id */
export async function verifyAuthentication(response: AuthenticationResponseJSON): Promise<number> {
  const expectedChallenge = await takeChallenge('login', null);
  const { rpID, origin } = await relyingParty();
  const [pk] = await sql<{ id: string; user_id: number; public_key: Buffer; counter: number; transports: string[]; webauthn_id: string }[]>`
    SELECT p.id, p.user_id, p.public_key, p.counter, p.transports, u.webauthn_id
    FROM passkeys p JOIN users u ON u.id = p.user_id WHERE p.id = ${response.id}`;
  if (!pk) throw new PasskeyError('Okänd passkey. Logga in med lösenord och lägg till passkeyn under Mitt konto.');
  // Autentiseraren anger vilket användar-id passkeyn skapades för – det måste stämma
  if (response.response.userHandle && response.response.userHandle !== pk.webauthn_id) throw new PasskeyError('Passkeyn tillhör en annan användare');
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      credential: { id: pk.id, publicKey: new Uint8Array(pk.public_key), counter: pk.counter, transports: pk.transports as AuthenticatorTransportFuture[] },
    });
  } catch (e) {
    throw new PasskeyError(`Inloggningen kunde inte verifieras: ${e instanceof Error ? e.message : e}`);
  }
  if (!verification.verified) throw new PasskeyError('Inloggningen kunde inte verifieras');
  await sql`UPDATE passkeys SET counter = ${verification.authenticationInfo.newCounter}, last_used_at = now(),
    backed_up = ${verification.authenticationInfo.credentialBackedUp} WHERE id = ${pk.id}`;
  await audit(sql, { companyId: null, userId: pk.user_id, action: 'login', entity: 'passkey' });
  return pk.user_id;
}

export async function listPasskeys(userId: number) {
  return sql<{ id: string; name: string; device_type: string; backed_up: boolean; created_at: string; last_used_at: string | null }[]>`
    SELECT id, name, device_type, backed_up,
      to_char(created_at AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD HH24:MI') AS created_at,
      to_char(last_used_at AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD HH24:MI') AS last_used_at
    FROM passkeys WHERE user_id = ${userId} ORDER BY created_at`;
}

export async function deletePasskey(userId: number, id: string) {
  const r = await sql`DELETE FROM passkeys WHERE id = ${id} AND user_id = ${userId} RETURNING name`;
  if (r.length) await audit(sql, { companyId: null, userId, action: 'remove', entity: 'passkey', details: { name: r[0].name } });
}
