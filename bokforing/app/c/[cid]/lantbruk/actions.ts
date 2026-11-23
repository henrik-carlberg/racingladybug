'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/farming';

const base = (cid: number) => `/c/${cid}/lantbruk`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function subsidyAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(base(cid), async () => { await svc.addSubsidy(actor, form(fd)); });
  done(base(cid), 'Stödansökan är registrerad');
}
export async function bookAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let a = 0;
  await attempt(base(cid), async () => { a = await svc.book(actor, id, form(fd)); });
  done(base(cid), `Fordran ${kr(a)} kr är bokförd för stödåret`);
}
export async function payAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let r = { amount: 0, diff: 0 };
  await attempt(base(cid), async () => { r = await svc.pay(actor, id, form(fd)); });
  done(base(cid), `Utbetalningen ${kr(r.amount)} kr är bokförd${r.diff ? ` (skillnad mot fordran ${kr(r.diff)} kr)` : ''}`);
}
export async function typeAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(base(cid), async () => { await svc.saveType(actor, form(fd)); });
  done(base(cid), 'Djurslaget är sparat');
}
export async function countAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let r = { value: 0, change: 0 };
  await attempt(base(cid), async () => { r = await svc.count(actor, form(fd)); });
  done(base(cid), `Djurinventeringen är värderad till ${kr(r.value)} kr (förändring ${kr(r.change)} kr)`);
}
