'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/tax-audits';

const base = (cid: number) => `/c/${cid}/skatterevision`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'ledger' }));

export async function openAction(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.open(actor, form(fd)); });
  done(base(cid), 'Ärendet är registrerat');
}
export async function requestAction(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.addRequest(actor, id, form(fd)); });
  done(base(cid), 'Begäran är registrerad');
}
export async function answerAction(cid: number, requestId: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.answer(actor, requestId, form(fd)); });
  done(base(cid), 'Begäran är besvarad');
}
export async function decideAction(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  let r = { total: 0, booked: false };
  await attempt(base(cid), async () => { r = await svc.decide(actor, id, form(fd)); });
  done(base(cid), r.booked ? `Beslutet är bokfört mot skattekontot: ${kr(r.total)} kr` : 'Beslutet är registrerat utan ändring');
}
export async function appealAction(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.appeal(actor, id, form(fd)); });
  done(base(cid), 'Begäran om omprövning eller överklagandet är registrerat');
}
export async function closeAction(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  let refund = 0;
  await attempt(base(cid), async () => { refund = await svc.close(actor, id, form(fd)); });
  done(base(cid), refund ? `Ärendet är avslutat – ${kr(refund)} kr tillbaka till skattekontot är bokfört` : 'Ärendet är avslutat');
}
