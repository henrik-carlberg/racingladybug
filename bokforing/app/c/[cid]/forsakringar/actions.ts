'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/insurance-policies';

const base = (cid: number) => `/c/${cid}/forsakringar`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function addAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(base(cid), async () => { await svc.add(actor, form(fd)); });
  done(base(cid), 'Försäkringen är registrerad');
}
export async function periodizeAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let a = 0;
  await attempt(base(cid), async () => { a = await svc.periodize(actor, form(fd)); });
  done(base(cid), `${kr(a)} kr av premierna är kostnadsförda`);
}
export async function renewAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(base(cid), async () => { await svc.renew(actor, id, form(fd)); });
  done(base(cid), 'Försäkringen är förnyad');
}
