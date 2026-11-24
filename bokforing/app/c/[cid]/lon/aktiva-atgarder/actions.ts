'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/active-measures';

const base = (cid: number) => `/c/${cid}/lon/aktiva-atgarder`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'payroll' }));

export async function addAction(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.add(actor, form(fd)); });
  done(base(cid), 'Undersökningen är dokumenterad');
}
export async function completeAction(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.complete(actor, id, form(fd)); });
  done(base(cid), 'Åtgärden är genomförd och uppföljd');
}
export async function policyAction(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.savePolicy(actor, form(fd)); });
  done(base(cid), 'Riktlinjerna och rutinerna är sparade');
}
