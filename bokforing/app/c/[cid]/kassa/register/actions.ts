'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/cash-register';

const base = (cid: number) => `/c/${cid}/kassa/register`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'ledger' }));
export async function addRegister(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), () => svc.addRegister(actor, form(fd)));
  done(base(cid), 'Kassaregistret med kontrollenhet är registrerat');
}
export async function addXReport(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), () => svc.addXReport(actor, form(fd)));
  done(base(cid), 'X-rapporten är sparad');
}
export async function deactivate(cid: number, id: number) {
  const actor = await actorFor(cid);
  await attempt(base(cid), () => svc.deactivate(actor, id));
  done(base(cid), 'Kassan är avregistrerad');
}
