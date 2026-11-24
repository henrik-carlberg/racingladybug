'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/product-costing';

const base = (cid: number) => `/c/${cid}/produktkalkyl`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function createAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  let c = { selfCost: 0, margin: null as number | null };
  await attempt(base(cid), async () => { c = await svc.create(actor, form(fd)); });
  done(base(cid), `Kalkylen är sparad – självkostnad ${kr(c.selfCost)} kr${c.margin != null ? `, marginal ${c.margin.toLocaleString('sv-SE')} %` : ''}`);
}
export async function priceAction(cid: number, id: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  let p = 0;
  await attempt(base(cid), async () => { p = await svc.applyPrice(actor, id); });
  done(base(cid), `Nytt pris ${kr(p)} kr exkl. moms`);
}
export async function ackAction(cid: number, id: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(base(cid), async () => { await svc.acknowledge(actor, id); });
  done(base(cid), 'Kalkylen är uppdaterad med dagens kostnader');
}
