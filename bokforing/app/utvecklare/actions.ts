'use server';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/server/auth';
import { AppError } from '@/lib/errors';
import { createApp, revokeApp, rotateSecret } from '@/lib/services/oauth';
import { createDemoCompany } from '@/lib/services/demo';

export type Created = { error?: string; clientId?: string; secret?: string | null; name?: string };
/** Hemligheten visas en gång i svaret – den hamnar aldrig i en adress eller logg */
export async function create(_prev: Created, fd: FormData): Promise<Created> {
  const user = await requireUser();
  try {
    const r = await createApp(user.id, { name: String(fd.get('name') ?? ''), description: String(fd.get('description') ?? ''), homepage: String(fd.get('homepage') ?? ''), redirect_uris: String(fd.get('redirect_uris') ?? ''), confidential: fd.get('public') !== 'on' });
    return { clientId: r.clientId, secret: r.secret, name: String(fd.get('name')) };
  } catch (e) { if (e instanceof AppError) return { error: e.message }; throw e; }
}
export async function rotate(appId: number, _prev: Created): Promise<Created> {
  const user = await requireUser();
  try { return { secret: await rotateSecret(user.id, appId) }; } catch (e) { if (e instanceof AppError) return { error: e.message }; throw e; }
}
export async function revoke(appId: number) {
  const user = await requireUser();
  await revokeApp(user.id, appId);
  redirect('/utvecklare?ok=' + encodeURIComponent('Appen är avregistrerad och alla kopplingar har upphört'));
}
export async function sandbox() {
  const user = await requireUser();
  redirect(`/c/${await createDemoCompany(user.id)}`);
}
