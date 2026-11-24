'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/authorizations';

const base = (cid: number) => `/c/${cid}/fullmakter`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { owner: true }));

export async function addAction(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.add(actor, form(fd)); });
  done(base(cid), 'Posten är sparad');
}
export async function revokeAction(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  let kind = '';
  await attempt(base(cid), async () => { kind = await svc.revoke(actor, id, form(fd)); });
  done(base(cid), kind === 'power_of_attorney' ? 'Fullmakten är återkallad – meddela också myndigheten eller banken' : 'Posten är avslutad');
}
export async function renewAction(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  let until = '';
  await attempt(base(cid), async () => { until = await svc.renew(actor, id, form(fd)); });
  done(base(cid), `Giltig till ${until}`);
}
