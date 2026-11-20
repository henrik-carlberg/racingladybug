'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/provisions';

const base = (cid: number, fy: number, q = '') => `/c/${cid}/bokslut/${fy}/avsattningar${q}`;
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'ledger' }));
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));

export async function addProvision(cid: number, fy: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid, fy), () => svc.addProvision(actor, form(fd)));
  done(base(cid, fy), 'Avsättningen är upplagd');
}
export async function move(cid: number, fy: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  let a = 0;
  await attempt(base(cid, fy), async () => { a = await svc.move(actor, id, form(fd)); });
  done(base(cid, fy), `${kr(a)} kr är bokfört`);
}
export async function warranty(cid: number, fy: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  const rate = String(fd.get('rate_pct') ?? '');
  let w = { change: 0, target: 0 };
  await attempt(base(cid, fy, `?rate=${encodeURIComponent(rate)}`), async () => { w = await svc.bookWarranty(actor, fy, id, { rate_pct: rate }); });
  done(base(cid, fy, `?rate=${encodeURIComponent(rate)}`), `Garantiavsättningen är ${w.change > 0 ? 'ökad' : 'minskad'} till ${kr(w.target)} kr`);
}
export async function addCommitment(cid: number, fy: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid, fy), () => svc.addCommitment(actor, form(fd)));
  done(base(cid, fy), 'Åtagandet är registrerat');
}
export async function endCommitment(cid: number, fy: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid, fy), () => svc.endCommitment(actor, id, form(fd)));
  done(base(cid, fy), 'Åtagandet är avslutat');
}
