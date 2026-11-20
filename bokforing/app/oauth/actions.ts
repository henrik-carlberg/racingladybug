'use server';
import { redirect } from 'next/navigation';
import { companyPolicyBlock, currentSession, requireUser } from '@/lib/server/auth';
import { approve, checkAuthorize, deny } from '@/lib/services/oauth';

/** Godkänn eller neka. Begäran kontrolleras igen från början (frågesträngen), inget litas på från formuläret utom bolaget. */
export async function decide(query: string, fd: FormData) {
  const user = await requireUser();
  const req = await checkAuthorize(new URLSearchParams(query));
  if (fd.get('decision') !== 'approve') redirect(deny(req));
  const companyId = Number(fd.get('company_id'));
  const s = await currentSession();
  const block = s && Number.isInteger(companyId) ? await companyPolicyBlock(companyId, s) : { msg: 'Ogiltigt bolag' };
  if (block) redirect(`/?error=${encodeURIComponent(block.msg)}`);
  redirect(await approve(user.id, req, companyId));
}
