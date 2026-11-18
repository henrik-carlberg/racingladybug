'use server';
import { redirect } from 'next/navigation';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { requestOrigin } from '@/lib/server/origin';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/payments';

const base = (cid: number) => `/c/${cid}/installningar/betalningar`;

export async function connect(cid: number) {
  const actor = userActor(await requireCompany(cid, { owner: true }));
  let url = '';
  await attempt(base(cid), async () => { url = await svc.connectStripe(actor, await requestOrigin()); });
  redirect(url);
}

export async function refresh(cid: number) {
  await requireCompany(cid, { owner: true });
  await attempt(base(cid), () => svc.refreshStripeAccount(cid));
  done(base(cid), 'Status hämtad från Stripe');
}

export async function disconnect(cid: number) {
  const actor = userActor(await requireCompany(cid, { owner: true }));
  await attempt(base(cid), () => svc.disconnectStripe(actor));
  done(base(cid), 'Kortbetalning är avstängd');
}

export async function resolve(cid: number, id: number) {
  const actor = userActor(await requireCompany(cid));
  await attempt(base(cid), () => svc.resolveIssue(actor, id));
  done(base(cid), 'Markerad som hanterad');
}
