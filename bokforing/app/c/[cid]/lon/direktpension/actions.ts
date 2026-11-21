'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/direct-pension';

const base = (cid: number) => `/c/${cid}/lon/direktpension`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'ledger' }));
export async function addCommitment(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), () => svc.addCommitment(actor, form(fd)));
  done(base(cid), 'Pensionsåtagandet är registrerat');
}
export async function valuate(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  let v = { change: 0, slp: 0 };
  await attempt(base(cid), async () => { v = await svc.valuate(actor, id, form(fd)); });
  done(base(cid), `Pensionsskulden är ${v.change > 0 ? 'ökad' : 'minskad'} med ${kr(Math.abs(v.change))} kr, särskild löneskatt ${kr(v.slp)} kr`);
}
export async function payPension(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  let a = 0;
  await attempt(base(cid), async () => { a = await svc.payPension(actor, id, form(fd)); });
  done(base(cid), `Utbetald pension ${kr(a)} kr är bokförd mot pensionsskulden`);
}
