'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/royalty';

const base = (cid: number) => `/c/${cid}/licenser`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'ledger' }));
export async function addAgreement(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), () => svc.addAgreement(actor, form(fd)));
  done(base(cid), 'Licensavtalet är sparat');
}
export async function report(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  let r = { amount: 0, minimumApplied: false };
  await attempt(base(cid), async () => { r = await svc.report(actor, id, form(fd)); });
  done(base(cid), `Royalty ${kr(r.amount)} kr är bokförd${r.minimumApplied ? ' (garanterad minimiavgift)' : ''}`);
}
export async function pay(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  let r = { net: 0, withheld: 0 };
  await attempt(base(cid), async () => { r = await svc.pay(actor, id, form(fd)); });
  done(base(cid), `Inbetalningen ${kr(r.net)} kr är bokförd${r.withheld ? `, utländsk källskatt ${kr(r.withheld)} kr` : ''}`);
}
