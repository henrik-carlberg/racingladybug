'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/board-meetings';

const base = (cid: number) => `/c/${cid}/styrelsemoten`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'ledger' }));

export async function createAction(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.createMeeting(actor, form(fd)); });
  done(base(cid), 'Mötet är skapat med en standarddagordning');
}
export async function itemAction(cid: number, meetingId: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.addItem(actor, meetingId, form(fd)); });
  done(base(cid), 'Punkten är tillagd');
}
export async function decideAction(cid: number, itemId: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.decide(actor, itemId, form(fd)); });
  done(base(cid), 'Beslutet är sparat');
}
export async function doneAction(cid: number, itemId: number) {
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.markDone(actor, itemId); });
  done(base(cid), 'Beslutet är genomfört');
}
export async function holdAction(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.hold(actor, id, form(fd)); });
  done(base(cid), 'Närvaron är registrerad');
}
export async function sendAction(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.sendMinutes(actor, id, form(fd)); });
  done(base(cid), 'Protokollet är skickat för justering');
}
