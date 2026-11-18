'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/firms';

const base = (cid: number) => `/c/${cid}/installningar/byra`;

export async function grant(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { owner: true }));
  let name = '';
  await attempt(base(cid), async () => { name = await svc.grantFirm(actor, str(fd, 'code')); });
  done(base(cid), `${name} har fått åtkomst till bokföringen`);
}

export async function revoke(cid: number, firmId: number) {
  const actor = userActor(await requireCompany(cid, { owner: true }));
  await attempt(base(cid), () => svc.revokeFirm(actor, firmId));
  done(base(cid), 'Byråns åtkomst är borttagen');
}
