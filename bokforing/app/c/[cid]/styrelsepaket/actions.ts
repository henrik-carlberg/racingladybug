'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/board-package';

const base = (cid: number) => `/c/${cid}/styrelsepaket`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'ledger' }));

export async function createAction(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  let r = { id: 0, from: '', to: '' };
  await attempt(base(cid), async () => { r = await svc.create(actor, form(fd)); });
  done(base(cid), `Styrelsepaketet för ${r.from} – ${r.to} är skapat`);
}
export async function sendAction(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  let n = 0;
  await attempt(base(cid), async () => { n = await svc.send(actor, id, form(fd)); });
  done(base(cid), `Styrelsepaketet är skickat till ${n} ledamöter`);
}
export async function commentAction(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.comment(actor, id, form(fd)); });
  done(base(cid), 'Kommentaren är sparad');
}
