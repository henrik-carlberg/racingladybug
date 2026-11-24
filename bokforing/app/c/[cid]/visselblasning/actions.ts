'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/whistleblowing';

const base = (cid: number) => `/c/${cid}/visselblasning`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const actorFor = async (cid: number) => userActor(await requireCompany(cid));

export async function enableAction(cid: number, on: boolean) {
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.enable(actor, on === true); });
  done(base(cid), on === true ? 'Visselblåsarkanalen är öppen' : 'Visselblåsarkanalen är stängd');
}
export async function handlerAction(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  const userId = Number(fd.get('user_id')), on = fd.get('on') === '1';
  await attempt(base(cid), async () => { if (!Number.isInteger(userId)) throw new Error('Välj användare'); await svc.setHandler(actor, userId, on); });
  done(base(cid), on ? 'Handläggaren är tillagd' : 'Handläggaren är borttagen');
}
export async function ackAction(cid: number, id: number) {
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.acknowledge(actor, id); });
  done(base(cid), 'Mottagandet är bekräftat');
}
export async function replyAction(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.handlerReply(actor, id, form(fd)); });
  done(base(cid), 'Meddelandet är skickat');
}
export async function closeAction(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.close(actor, id, form(fd)); });
  done(base(cid), 'Ärendet är avslutat');
}
