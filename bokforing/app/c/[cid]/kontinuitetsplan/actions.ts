'use server';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { attempt, done } from '@/lib/server/action';
import * as svc from '@/lib/services/continuity';

const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const path = (cid: number) => `/c/${cid}/kontinuitetsplan`;
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { owner: true }));

export async function taskAction(cid: number, id: number | null, fd: FormData) {
  const a = await actorFor(cid); await attempt(path(cid), () => svc.saveTask(a, id, form(fd))); done(path(cid), 'Uppgiften är sparad');
}
export async function standardAction(cid: number) {
  const a = await actorFor(cid); let n = 0; await attempt(path(cid), async () => { n = await svc.addStandard(a); }); done(path(cid), `${n} kritiska uppgifter är tillagda`);
}
export async function removeTaskAction(cid: number, id: number) {
  const a = await actorFor(cid); await attempt(path(cid), () => svc.removeTask(a, id)); done(path(cid), 'Uppgiften är borttagen');
}
export async function contactAction(cid: number, fd: FormData) {
  const a = await actorFor(cid); await attempt(path(cid), () => svc.saveContact(a, form(fd))); done(path(cid), 'Kontakten är sparad');
}
export async function removeContactAction(cid: number, id: number) {
  const a = await actorFor(cid); await attempt(path(cid), () => svc.removeContact(a, id)); done(path(cid), 'Kontakten är borttagen');
}
export async function planAction(cid: number, fd: FormData) {
  const a = await actorFor(cid); const review = fd.get('review') === '1';
  await attempt(path(cid), () => svc.savePlan(a, form(fd), review)); done(path(cid), review ? 'Planen är genomgången' : 'Krisrutinen är sparad');
}
