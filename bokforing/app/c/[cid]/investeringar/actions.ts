'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/investments';

const base = (cid: number) => `/c/${cid}/investeringar`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'ledger' }));

export async function addAction(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  let r: Awaited<ReturnType<typeof svc.add>> | undefined;
  await attempt(base(cid), async () => { r = await svc.add(actor, form(fd)); });
  done(base(cid), r ? `Kalkylen är sparad – nuvärde ${kr(r.npv)} kr${r.irr != null ? `, internränta ${r.irr.toLocaleString('sv-SE')} %` : ''}` : 'Kalkylen är sparad');
}
export async function decideAction(cid: number, id: number, approve: boolean) {
  const actor = await actorFor(cid);
  let asset: number | null = null;
  await attempt(base(cid), async () => { asset = await svc.decide(actor, id, approve === true); });
  done(base(cid), asset ? 'Investeringen är godkänd och upplagd i anläggningsregistret' : 'Investeringen är avslagen');
}
