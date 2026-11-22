'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/garnishment';

const base = (cid: number) => `/c/${cid}/lon/utmatning`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'payroll' }));
export async function addDecision(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), () => svc.addDecision(actor, form(fd)));
  done(base(cid), 'Beslutet om löneutmätning är registrerat');
}
export async function applyToRun(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  let r = { amount: 0, netPay: 0 };
  await attempt(base(cid), async () => { r = await svc.applyToRun(actor, id, form(fd)); });
  done(base(cid), r.amount ? `Löneutmätning ${kr(r.amount)} kr dras på lönen` : `Ingen utmätning denna månad: nettolönen ${kr(r.netPay)} kr når inte över förbehållsbeloppet`);
}
export async function pay(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  let t = 0;
  await attempt(base(cid), async () => { t = await svc.payToKfm(actor, form(fd)); });
  done(base(cid), `${kr(t)} kr är bokfört som inbetalt till Kronofogden`);
}
export async function endDecision(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), () => svc.endDecision(actor, id, form(fd)));
  done(base(cid), 'Beslutet har upphört');
}
