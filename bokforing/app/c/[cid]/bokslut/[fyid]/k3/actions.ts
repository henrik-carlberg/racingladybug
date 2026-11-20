'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as k from '@/lib/services/k3';

const back = (cid: number, fy: number) => `/c/${cid}/bokslut/${fy}/k3`;
const obj = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
export async function switchFramework(cid: number, fy: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { owner: true }));
  await attempt(back(cid, fy), () => k.setFramework(a, fy, obj(fd)));
  done(back(cid, fy), fd.get('framework') === 'K3' ? 'Bolaget tillämpar nu K3 från räkenskapsårets början' : 'Bolaget tillämpar nu K2');
}
export async function addDiff(cid: number, fy: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid, fy), () => k.addDiff(a, fy, obj(fd)));
  done(back(cid, fy), 'Den temporära skillnaden är sparad');
}
export async function removeDiff(cid: number, fy: number, id: number) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid, fy), () => k.removeDiff(a, id));
  done(back(cid, fy), 'Posten är borttagen');
}
export async function book(cid: number, fy: number) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid, fy), () => k.bookDeferredTax(a, fy));
  done(back(cid, fy), 'Den uppskjutna skatten är bokförd');
}
