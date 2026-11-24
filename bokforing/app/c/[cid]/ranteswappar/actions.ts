'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/interest-swaps';

const base = (cid: number) => `/c/${cid}/ranteswappar`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'ledger' }));

export async function addAction(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.add(actor, form(fd)); });
  done(base(cid), 'Ränteswappen är registrerad');
}
export async function settleAction(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  let r = { amount: 0, period: '' };
  await attempt(base(cid), async () => { r = await svc.settle(actor, id, form(fd)); });
  done(base(cid), r.amount > 0 ? `Avräkning ${r.period}: bolaget får ${kr(r.amount)} kr, som minskar räntekostnaden` : r.amount < 0 ? `Avräkning ${r.period}: bolaget betalar ${kr(-r.amount)} kr, som ökar räntekostnaden` : `Avräkning ${r.period}: ingen betalning`);
}
export async function valueAction(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  let mv = 0;
  await attempt(base(cid), async () => { mv = await svc.value(actor, id, form(fd)); });
  done(base(cid), `Marknadsvärdet ${kr(mv)} kr är sparat för upplysningen i årsredovisningen`);
}
