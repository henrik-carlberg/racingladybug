import 'server-only';
import { cookies } from 'next/headers';
import { sql } from '@/lib/db';
import { createSession, newToken, sha256 } from './auth';
import { normalizeBackupCode, totpStep } from '@/lib/totp';

const COOKIE = 'mfa';

/** Efter rätt lösenord: logga in direkt, eller kräv engångskod om tvåstegsverifiering är på. Returnerar sökvägen att gå vidare till. */
export async function startLogin(userId: number, next = '/'): Promise<string> {
  const [u] = await sql<{ on: boolean }[]>`SELECT totp_enabled_at IS NOT NULL AS on FROM users WHERE id = ${userId}`;
  if (!u?.on) { await createSession(userId, { method: 'password' }); return next; }
  const token = newToken();
  await sql`DELETE FROM mfa_challenges WHERE expires_at < now()`;
  await sql`INSERT INTO mfa_challenges (id, user_id, expires_at) VALUES (${sha256(token)}, ${userId}, now() + interval '10 minutes')`;
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 600 });
  return '/login/kod';
}

export async function pendingChallenge(): Promise<{ id: string; user_id: number; email: string } | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const [c] = await sql<{ id: string; user_id: number; email: string }[]>`
    SELECT c.id, c.user_id, u.email FROM mfa_challenges c JOIN users u ON u.id = c.user_id WHERE c.id = ${sha256(token)} AND c.expires_at > now() AND c.attempts < 5`;
  return c ?? null;
}

/** Kontrollerar engångskod eller reservkod; skapar sessionen om den stämmer */
export async function completeLogin(code: string): Promise<{ ok: boolean; backupUsed?: boolean }> {
  const c = await pendingChallenge();
  if (!c) throw new Error('Inloggningen har gått ut – börja om');
  await sql`UPDATE mfa_challenges SET attempts = attempts + 1 WHERE id = ${c.id}`;
  const [u] = await sql<{ secret: string; codes: string[] }[]>`SELECT totp_secret AS secret, backup_codes AS codes FROM users WHERE id = ${c.user_id}`;
  let backupUsed = false;
  const step = totpStep(u.secret, code);
  // En kod kan bara användas en gång
  let ok = step !== null && (await sql`UPDATE users SET totp_last_step = ${step} WHERE id = ${c.user_id} AND COALESCE(totp_last_step, 0) < ${step}`).count === 1;
  if (!ok) {
    const h = sha256(normalizeBackupCode(code));
    if (normalizeBackupCode(code).length === 10 && u.codes.includes(h)) {
      const r = await sql`UPDATE users SET backup_codes = array_remove(backup_codes, ${h}) WHERE id = ${c.user_id} AND ${h} = ANY(backup_codes)`;
      ok = r.count === 1; backupUsed = ok;
    }
  }
  if (!ok) return { ok: false };
  await sql`DELETE FROM mfa_challenges WHERE id = ${c.id}`;
  (await cookies()).delete(COOKIE);
  await createSession(c.user_id, { method: 'totp', mfa: true });
  return { ok: true, backupUsed };
}
