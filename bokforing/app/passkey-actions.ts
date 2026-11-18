'use server';
import { limit, LIMITS } from '@/lib/server/ratelimit';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { revalidatePath } from 'next/cache';
import { createSession, destroyOtherSessions, hashPassword, requireUser, verifyPassword } from '@/lib/server/auth';
import { authenticationOptions, deletePasskey, registrationOptions, verifyAuthentication, verifyRegistration } from '@/lib/server/passkeys';
import { attempt, done, str } from '@/lib/server/action';
import { audit } from '@/lib/server/audit';
import { sql } from '@/lib/db';

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => {
  console.error('passkey', e);
  return { ok: false, error: e instanceof Error ? e.message : 'Något gick fel' };
};

export async function passkeyLoginOptions(): Promise<Result<{ options: Awaited<ReturnType<typeof authenticationOptions>> }>> {
  try { return { ok: true, options: await authenticationOptions() }; } catch (e) { return fail(e); }
}

export async function passkeyLogin(response: AuthenticationResponseJSON): Promise<Result> {
  try {
    const userId = await verifyAuthentication(response);
    await createSession(userId);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function passkeyRegisterOptions(): Promise<Result<{ options: Awaited<ReturnType<typeof registrationOptions>> }>> {
  try { return { ok: true, options: await registrationOptions(await requireUser()) }; } catch (e) { return fail(e); }
}

export async function passkeyRegister(response: RegistrationResponseJSON, name: string): Promise<Result> {
  try {
    await verifyRegistration(await requireUser(), response, name);
    revalidatePath('/konto');
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function removePasskey(id: string) {
  const user = await requireUser();
  await deletePasskey(user.id, id);
  done('/konto', 'Passkeyn är borttagen');
}

export async function changePassword(fd: FormData) {
  const user = await requireUser();
  await attempt('/konto', async () => {
    await limit(`pw:${user.id}`, LIMITS.passwordChange.max, LIMITS.passwordChange.window);
    const [u] = await sql<{ password_hash: string }[]>`SELECT password_hash FROM users WHERE id = ${user.id}`;
    if (!(await verifyPassword(str(fd, 'current'), u.password_hash))) throw new Error('Nuvarande lösenord är fel');
    const pw = str(fd, 'password');
    if (pw.length < 10) throw new Error('Lösenordet måste vara minst 10 tecken');
    await sql`UPDATE users SET password_hash = ${await hashPassword(pw)} WHERE id = ${user.id}`;
    // Logga ut övriga sessioner när lösenordet byts
    await destroyOtherSessions(user.id);
    await audit(sql, { companyId: null, userId: user.id, action: 'change_password', entity: 'user', entityId: user.id });
  });
  done('/konto', 'Lösenordet är bytt');
}
