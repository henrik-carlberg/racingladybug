'use server';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/server/auth';
import { approve, checkAuthorize, deny } from '@/lib/services/oauth';

/** Godkänn eller neka. Begäran kontrolleras igen från början (frågesträngen), inget litas på från formuläret utom bolaget. */
export async function decide(query: string, fd: FormData) {
  const user = await requireUser();
  const req = await checkAuthorize(new URLSearchParams(query));
  if (fd.get('decision') !== 'approve') redirect(deny(req));
  redirect(await approve(user.id, req, Number(fd.get('company_id'))));
}
