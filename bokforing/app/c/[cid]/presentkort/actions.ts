'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/gift-cards';

const base = (cid: number) => `/c/${cid}/presentkort`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'ledger' }));
export async function sell(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), () => svc.sell(actor, form(fd)));
  done(base(cid), 'Presentkortet är sålt och bokfört');
}
export async function redeem(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  let left = 0;
  await attempt(base(cid), async () => { left = (await svc.redeem(actor, form(fd))).left; });
  done(base(cid), `Inlösen bokförd, kvar på kortet ${kr(left)} kr`);
}
export async function expire(cid: number) {
  const actor = await actorFor(cid);
  let r = { count: 0, amount: 0 };
  await attempt(base(cid), async () => { r = await svc.expire(actor); });
  done(base(cid), `${r.count} utgångna presentkort (${kr(r.amount)} kr) är intäktsförda`);
}
