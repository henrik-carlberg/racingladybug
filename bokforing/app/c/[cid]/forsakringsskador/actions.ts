'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/damage-claims';

const base = (cid: number) => `/c/${cid}/forsakringsskador`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function reportAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let w = 0;
  await attempt(base(cid), async () => { w = (await svc.report(actor, form(fd))).writtenOff; });
  done(base(cid), `Skadan är registrerad${w ? ` – ${kr(w)} kr har skrivits bort` : ''}`);
}
export async function assessAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let r = { compensation: 0, deductible: 0, fund: false };
  await attempt(base(cid), async () => { r = await svc.assess(actor, id, form(fd)); });
  done(base(cid), r.compensation ? `Ersättningen ${kr(r.compensation)} kr är bokförd som fordran (självrisk ${kr(r.deductible)} kr)${r.fund ? '. Den kan sättas av till ersättningsfond i bokslutet' : ''}` : 'Ärendet är avslutat utan ersättning');
}
export async function payAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'payments' }));
  let a = 0;
  await attempt(base(cid), async () => { a = await svc.pay(actor, id, form(fd)); });
  done(base(cid), `Utbetalningen ${kr(a)} kr är bokförd`);
}
