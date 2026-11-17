'use server';
import { cookies } from 'next/headers';
import { sql } from '@/lib/db';
import { attempt, done, str } from '@/lib/server/action';
import { destroyOtherSessions, requireUser, sha256, verifyPassword } from '@/lib/server/auth';
import { audit } from '@/lib/server/audit';
import { newBackupCodes, newTotpSecret, normalizeBackupCode, verifyTotp } from '@/lib/totp';

/** Nya reservkoder visas en gång via en kortlivad cookie för /konto */
async function showCodes(codes: string[]) {
  (await cookies()).set('backup_codes', codes.join(' '), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/konto', maxAge: 300 });
}

export async function startTotp() {
  const user = await requireUser();
  await sql`UPDATE users SET totp_secret = ${newTotpSecret()} WHERE id = ${user.id} AND totp_enabled_at IS NULL`;
  done('/konto#tvasteg');
}

export async function confirmTotp(fd: FormData) {
  const user = await requireUser();
  await attempt('/konto#tvasteg', async () => {
    const [u] = await sql<{ secret: string | null }[]>`SELECT totp_secret AS secret FROM users WHERE id = ${user.id} AND totp_enabled_at IS NULL`;
    if (!u?.secret) throw new Error('Börja om med att slå på tvåstegsverifiering');
    if (!verifyTotp(u.secret, str(fd, 'code'))) throw new Error('Koden stämmer inte. Kontrollera att telefonens klocka går rätt och försök igen.');
    const codes = newBackupCodes();
    await sql`UPDATE users SET totp_enabled_at = now(), backup_codes = ${codes.map((c) => sha256(normalizeBackupCode(c)))} WHERE id = ${user.id}`;
    await audit(sql, { companyId: null, userId: user.id, action: 'enable_2fa', entity: 'user', entityId: user.id });
    await destroyOtherSessions(user.id);
    await showCodes(codes);
  });
  done('/konto#tvasteg', 'Tvåstegsverifiering är på. Spara reservkoderna.');
}

export async function cancelTotp() {
  const user = await requireUser();
  await sql`UPDATE users SET totp_secret = NULL WHERE id = ${user.id} AND totp_enabled_at IS NULL`;
  done('/konto#tvasteg');
}

export async function disableTotp(fd: FormData) {
  const user = await requireUser();
  await attempt('/konto#tvasteg', async () => {
    const [u] = await sql<{ hash: string }[]>`SELECT password_hash AS hash FROM users WHERE id = ${user.id}`;
    if (!(await verifyPassword(str(fd, 'password'), u.hash))) throw new Error('Fel lösenord');
    await sql`UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, backup_codes = '{}', totp_last_step = NULL WHERE id = ${user.id}`;
    await audit(sql, { companyId: null, userId: user.id, action: 'disable_2fa', entity: 'user', entityId: user.id });
  });
  done('/konto#tvasteg', 'Tvåstegsverifiering är avstängd');
}

export async function regenerateCodes(fd: FormData) {
  const user = await requireUser();
  await attempt('/konto#tvasteg', async () => {
    const [u] = await sql<{ hash: string }[]>`SELECT password_hash AS hash FROM users WHERE id = ${user.id} AND totp_enabled_at IS NOT NULL`;
    if (!u || !(await verifyPassword(str(fd, 'password'), u.hash))) throw new Error('Fel lösenord');
    const codes = newBackupCodes();
    await sql`UPDATE users SET backup_codes = ${codes.map((c) => sha256(normalizeBackupCode(c)))} WHERE id = ${user.id}`;
    await showCodes(codes);
  });
  done('/konto#tvasteg', 'Nya reservkoder är skapade – de gamla gäller inte längre');
}
