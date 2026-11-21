'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import { acquire } from '@/lib/services/business-acquisition';

export async function acquireAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const back = `/c/${cid}/forvarv`;
  let r = { goodwill: 0, assets: 0 };
  await attempt(back, async () => { r = await acquire(actor, Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]))); });
  done(back, `Förvärvet är bokfört: tillgångar ${kr(r.assets)} kr och goodwill ${kr(r.goodwill)} kr, inlagda i anläggningsregistret`);
}
