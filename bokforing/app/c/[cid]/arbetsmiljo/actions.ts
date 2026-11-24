'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { INCIDENTS, duties } from '@/lib/work-environment';
import * as svc from '@/lib/services/work-environment';

const base = (cid: number) => `/c/${cid}/arbetsmiljo`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'payroll' }));

export async function riskAction(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.addRisk(actor, form(fd)); });
  done(base(cid), 'Riskbedömningen är sparad');
}
export async function riskDoneAction(cid: number, id: number) {
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.riskDone(actor, id); });
  done(base(cid), 'Åtgärden är genomförd');
}
export async function incidentAction(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  let kind: keyof typeof INCIDENTS = 'near_miss';
  await attempt(base(cid), async () => { kind = await svc.addIncident(actor, form(fd)); });
  const d = duties(kind);
  done(base(cid), `Händelsen är registrerad${d.av ? '. Anmäl den till Arbetsmiljöverket utan dröjsmål' : ''}${d.fk ? `${d.av ? ' och' : '. Anmäl'} arbetsskadan till Försäkringskassan` : ''}`);
}
export async function reportedAction(cid: number, id: number, to: 'av' | 'fk') {
  if (to !== 'av' && to !== 'fk') throw new Error('Ogiltig mottagare');
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.markReported(actor, id, to); });
  done(base(cid), to === 'av' ? 'Anmälan till Arbetsmiljöverket är registrerad' : 'Anmälan till Försäkringskassan är registrerad');
}
export async function reviewAction(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  let r = { done: 0, complete: false };
  await attempt(base(cid), async () => { r = await svc.saveReview(actor, form(fd)); });
  done(base(cid), r.complete ? 'Årets uppföljning är klar' : `Uppföljningen är sparad (${r.done} punkter klara)`);
}
