'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/data-protection';

const base = (cid: number) => `/c/${cid}/dataskydd`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const actorFor = async (cid: number) => userActor(await requireCompany(cid));

export async function activityAction(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.addActivity(actor, form(fd)); });
  done(base(cid), 'Behandlingen är tillagd i registret');
}
export async function incidentAction(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  let d = { imy: false, subjects: false };
  await attempt(base(cid), async () => { d = await svc.addIncident(actor, form(fd)); });
  done(base(cid), `Incidenten är registrerad${d.imy ? '. Anmäl den till IMY inom 72 timmar från upptäckten' : '. Den behöver inte anmälas, men dokumentationen ska finnas kvar'}${d.subjects ? ' och informera de registrerade utan onödigt dröjsmål' : ''}`);
}
export async function updateAction(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.update(actor, id, form(fd)); });
  done(base(cid), 'Incidenten är uppdaterad');
}
export async function closeAction(cid: number, id: number) {
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.close(actor, id); });
  done(base(cid), 'Incidenten är avslutad');
}
