'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/las';

const base = (cid: number) => `/c/${cid}/lon/las`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'payroll' }));

export async function periodAction(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.addPeriod(actor, form(fd)); });
  done(base(cid), 'Anställningsperioden är sparad');
}
export async function removeAction(cid: number, id: number) {
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.removePeriod(actor, id); });
  done(base(cid), 'Perioden är borttagen');
}
export async function exemptAction(cid: number, employeeId: number, on: boolean) {
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.setExempt(actor, employeeId, on === true); });
  done(base(cid), on === true ? 'Den anställda är undantagen från turordningen' : 'Undantaget är borttaget');
}
