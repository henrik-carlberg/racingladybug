'use server';
import { redirect } from 'next/navigation';
import { attempt } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { requestOrigin } from '@/lib/server/origin';
import { userActor } from '@/lib/services/actor';
import { checkout, portal } from '@/lib/services/billing';

export async function startCheckout(cid: number) {
  const ctx = await requireCompany(cid, { owner: true, allowLocked: true });
  let url = '';
  await attempt(`/c/${cid}/abonnemang`, async () => { url = await checkout(userActor(ctx), await requestOrigin(), ctx.user.email); });
  redirect(url);
}

export async function openPortal(cid: number) {
  const ctx = await requireCompany(cid, { owner: true, allowLocked: true });
  let url = '';
  await attempt(`/c/${cid}/abonnemang`, async () => { url = await portal(userActor(ctx), await requestOrigin()); });
  redirect(url);
}
