'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/kpi-alerts';

const base = (cid: number) => `/c/${cid}/nyckeltal/larm`;
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'ledger' }));

export async function addAction(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  let r = { triggered: 0, cleared: 0 };
  await attempt(base(cid), async () => { r = await svc.add(actor, Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'))); });
  done(base(cid), r.triggered ? 'Larmet är sparat – och har redan utlösts' : 'Larmet är sparat');
}
export async function toggleAction(cid: number, id: number, active: boolean) {
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.toggle(actor, id, active === true); });
  done(base(cid), active === true ? 'Larmet är på' : 'Larmet är avstängt');
}
