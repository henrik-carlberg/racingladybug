'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/fx-forwards';

const base = (cid: number) => `/c/${cid}/valutaterminer`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'ledger' }));
export async function addForward(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), () => svc.addForward(actor, form(fd)));
  done(base(cid), 'Terminen är registrerad');
}
export async function valuate(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  let y = { value: 0, reserve: 0, change: 0 };
  await attempt(base(cid), async () => { y = await svc.valuate(actor, id, form(fd)); });
  done(base(cid), `Terminens värde ${kr(y.value)} kr; reserv för orealiserad förlust ${kr(y.reserve)} kr`);
}
export async function settle(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  let r = 0;
  await attempt(base(cid), async () => { r = await svc.settle(actor, id, form(fd)); });
  done(base(cid), `Terminen är avräknad: ${r >= 0 ? 'kursvinst' : 'kursförlust'} ${kr(Math.abs(r))} kr`);
}
