'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/supplier-prepayments';

const base = (cid: number) => `/c/${cid}/leverantorsfakturor/forskott`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'payments' }));

export async function prepayAction(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), () => svc.prepay(actor, form(fd)));
  done(base(cid), 'Förskottet är bokfört på 1480');
}
export async function settleAction(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  let r = { amount: 0, left: 0 };
  await attempt(base(cid), async () => { r = await svc.settle(actor, id, form(fd)); });
  done(base(cid), `${kr(r.amount)} kr av förskottet är avräknat – kvar att betala på fakturan: ${kr(r.left)} kr`);
}
export async function refundAction(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  let left = 0;
  await attempt(base(cid), async () => { left = await svc.refund(actor, id, form(fd)); });
  done(base(cid), `Återbetalt förskott ${kr(left)} kr är bokfört`);
}
