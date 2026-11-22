'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/payment-orders';

const base = (cid: number) => `/c/${cid}/betalningsforelaggande`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'invoicing' }));
export async function apply(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  let r = { capital: 0, interest: 0 };
  await attempt(base(cid), async () => { r = await svc.apply(actor, form(fd)); });
  done(base(cid), `Ansökan är registrerad: kapital ${kr(r.capital)} kr, dröjsmålsränta hittills ${kr(r.interest)} kr, ansökningsavgiften är bokförd som fordran`);
}
export async function setStatus(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), () => svc.setStatus(actor, id, form(fd)));
  done(base(cid), 'Statusen är uppdaterad');
}
export async function receive(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'payments' }));
  let a = { fee: 0, reminder: 0, interest: 0, capital: 0 };
  await attempt(base(cid), async () => { a = await svc.receive(actor, id, form(fd)); });
  done(base(cid), `Inbetalningen är fördelad: kostnader ${kr(a.fee + a.reminder)} kr, ränta ${kr(a.interest)} kr, kapital ${kr(a.capital)} kr`);
}
