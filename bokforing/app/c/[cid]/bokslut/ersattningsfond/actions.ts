'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/replacement-fund';

const base = (cid: number) => `/c/${cid}/bokslut/ersattningsfond`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'ledger' }));
export async function addClaim(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), () => svc.addClaim(actor, form(fd)));
  done(base(cid), 'Skadan och försäkringsersättningen är bokförda');
}
export async function setFund(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), () => svc.setFund(actor, id, form(fd)));
  done(base(cid), 'Avsättningen till ersättningsfond är bokförd');
}
export async function useFund(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  const action = String(fd.get('action') ?? 'use');
  let a = 0;
  await attempt(base(cid), async () => { a = await svc.useOrReverse(actor, id, form(fd)); });
  done(base(cid), `${action === 'reverse' ? 'Återförd' : 'Ianspråktagen'} ersättningsfond ${kr(a)} kr är bokförd`);
}
