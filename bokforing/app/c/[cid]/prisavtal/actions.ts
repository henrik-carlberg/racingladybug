'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/customer-prices';

const base = (cid: number) => `/c/${cid}/prisavtal`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function groupAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(base(cid), async () => { await svc.addGroup(actor, form(fd)); });
  done(base(cid), 'Kundgruppen är upplagd');
}
export async function memberAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(base(cid), async () => { await svc.setGroup(actor, form(fd)); });
  done(base(cid), 'Kundens grupp är sparad');
}
export async function agreementAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(base(cid), async () => { await svc.addAgreement(actor, form(fd)); });
  done(base(cid), 'Prisavtalet är upplagt');
}
export async function endAction(cid: number, id: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(base(cid), async () => { await svc.endAgreement(actor, id); });
  done(base(cid), 'Avtalet är avslutat');
}
