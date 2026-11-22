'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/cashbook';

export async function count(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const base = `/c/${cid}/kassabok`;
  let r = { diff: 0 };
  await attempt(base, async () => { r = await svc.count(actor, Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]))); });
  done(base, r.diff ? `Kassainventeringen är sparad: ${r.diff > 0 ? 'överskott' : 'underskott'} ${kr(Math.abs(r.diff))} kr bokfört på 3740` : 'Kassainventeringen är sparad – kassan stämmer');
}
