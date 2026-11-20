'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/kpo';

const base = (cid: number) => `/c/${cid}/lon/personaloptioner`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'payroll' }));
export async function addProgram(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), () => svc.addProgram(actor, form(fd)));
  done(base(cid), 'Optionsprogrammet är upplagt');
}
export async function grant(cid: number, pid: number, fd: FormData) {
  const actor = await actorFor(cid);
  let r = { id: 0, vested: '' };
  await attempt(base(cid), async () => { r = await svc.grant(actor, pid, form(fd)); });
  done(base(cid), `Optionerna är tilldelade – de kan utnyttjas som kvalificerade från ${r.vested}`);
}
export async function exerciseAction(cid: number, gid: number, fd: FormData) {
  const actor = await actorFor(cid);
  let r = { qualified: false, benefit: 0, reason: '' };
  await attempt(base(cid), async () => { r = await svc.exercise(actor, gid, form(fd)); });
  done(base(cid), r.qualified ? r.reason : `${r.reason}: förmånsvärde ${kr(r.benefit)} kr – lägg in det som förmån i lönekörningen`);
}
