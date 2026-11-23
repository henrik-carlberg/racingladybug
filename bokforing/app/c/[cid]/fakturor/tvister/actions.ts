'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/disputes';

const base = (cid: number) => `/c/${cid}/fakturor/tvister`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function openAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  let po = false;
  await attempt(base(cid), async () => { po = (await svc.openDispute(actor, form(fd))).paymentOrder; });
  done(base(cid), `Fakturan är markerad som tvistig – påminnelser och inkasso är pausade${po ? '. Fakturan har ett betalningsföreläggande: meddela Kronofogden att kunden har bestritt' : ''}`);
}
export async function closeAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  let s = '';
  await attempt(base(cid), async () => { s = await svc.close(actor, id, form(fd)); });
  done(base(cid), s === 'paid' ? 'Tvisten är avslutad – fakturan är betald' : 'Tvisten är avslutad – påminnelserna fortsätter');
}
export async function settleAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'payments' }));
  let r = { agreed: 0, reduction: 0 };
  await attempt(base(cid), async () => { r = await svc.settle(actor, id, form(fd)); });
  done(base(cid), `Förlikningen är bokförd: inbetalt ${kr(r.agreed)} kr, nedsatt ${kr(r.reduction)} kr med momsreduktion`);
}
