'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/packaging';

const base = (cid: number) => `/c/${cid}/emballage`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function typeAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(base(cid), async () => { await svc.addType(actor, form(fd)); });
  done(base(cid), 'Förpackningstypen är upplagd');
}
export async function deliverAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  let id = 0;
  await attempt(base(cid), async () => { id = await svc.deliver(actor, form(fd)); });
  done(`/c/${cid}/fakturor/${id}`, 'Fakturautkast med pant för emballaget är skapat – granska och bokför');
}
export async function returnAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  let id = 0;
  await attempt(base(cid), async () => { id = await svc.returnPackaging(actor, form(fd)); });
  done(`/c/${cid}/fakturor/${id}`, 'Kreditfakturautkast för återbetald pant är skapat – granska och bokför');
}
export async function forfeitAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let r = { quantity: 0, amount: 0 };
  await attempt(base(cid), async () => { r = await svc.forfeit(actor, form(fd)); });
  done(base(cid), `Pant för ${r.quantity} förpackningar (${kr(r.amount)} kr) är förverkad och intäktsförd`);
}
