'use server';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { revalidatePath } from 'next/cache';
import { attempt, done, fileFrom, str } from '@/lib/server/action';
import { requireCompany, requireUser } from '@/lib/server/auth';
import { clientInfo, requestOrigin } from '@/lib/server/origin';
import { signingOptions, verifySigning } from '@/lib/server/passkeys';
import { userActor } from '@/lib/services/actor';
import * as docs from '@/lib/services/documents';

export async function createDoc(cid: number, fd: FormData) {
  const ctx = await requireCompany(cid);
  const actor = userActor(ctx);
  let id = 0;
  await attempt(`/c/${cid}/dokument`, async () => {
    const signers = [];
    for (let i = 0; i < 6; i++) {
      const internal = str(fd, `user_${i}`);
      const name = str(fd, `name_${i}`), email = str(fd, `email_${i}`);
      if (internal) signers.push({ user_id: internal, name: str(fd, `uname_${internal}`) });
      else if (name || email) signers.push({ name, email });
    }
    const pdf = await fileFrom(fd);
    const text = str(fd, 'text');
    const d = await docs.createDocument(actor, {
      title: str(fd, 'title'), message: str(fd, 'message'), signers,
      ...(pdf ? { pdf_base64: pdf.data.toString('base64'), filename: pdf.filename } : { html: docs.textToHtml(text) }),
    });
    id = d.id;
    if (fd.get('send') === 'on') await docs.sendDocument(actor, d.id, await requestOrigin());
  });
  done(`/c/${cid}/dokument/${id}`, fd.get('send') === 'on' ? 'Dokumentet är skickat för signering' : 'Dokumentet är sparat som utkast');
}

export async function sendDoc(cid: number, id: number) {
  const actor = userActor(await requireCompany(cid));
  await attempt(`/c/${cid}/dokument/${id}`, async () => docs.sendDocument(actor, id, await requestOrigin()));
  done(`/c/${cid}/dokument/${id}`, 'Dokumentet är skickat för signering');
}

export async function cancelDoc(cid: number, id: number) {
  const actor = userActor(await requireCompany(cid));
  await attempt(`/c/${cid}/dokument/${id}`, () => docs.cancelDocument(actor, id));
  done(`/c/${cid}/dokument/${id}`, 'Dokumentet är återkallat');
}

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : 'Något gick fel' });

export async function signPasskeyOptions(signerId: number): Promise<R<{ options: Awaited<ReturnType<typeof signingOptions>> }>> {
  try {
    const user = await requireUser();
    return { ok: true, options: await signingOptions(user, `signer:${signerId}`, await docs.signerDocumentHash(user.id, signerId)) };
  } catch (e) { return fail(e); }
}

export async function signPasskey(path: string, signerId: number, response: AuthenticationResponseJSON): Promise<R> {
  try {
    const user = await requireUser();
    const evidence = await verifySigning(user, `signer:${signerId}`, response);
    await docs.signAsUserWithPasskey(user, signerId, evidence, await clientInfo());
    revalidatePath(path);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function signPassword(path: string, signerId: number, password: string): Promise<R> {
  try {
    const user = await requireUser();
    await docs.signAsUserWithPassword(user, signerId, password, await clientInfo());
    revalidatePath(path);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function declineAsUser(path: string, signerId: number, reason: string): Promise<R> {
  try {
    await docs.declineAsUser(await requireUser(), signerId, reason, await clientInfo());
    revalidatePath(path);
    return { ok: true };
  } catch (e) { return fail(e); }
}
