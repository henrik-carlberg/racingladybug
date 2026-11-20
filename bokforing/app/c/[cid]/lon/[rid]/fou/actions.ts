'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/fou';

const base = (cid: number, rid: number) => `/c/${cid}/lon/${rid}/fou`;
export async function setHours(cid: number, rid: number, pid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'payroll' }));
  await attempt(base(cid, rid), () => svc.setHours(actor, rid, pid, Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]))));
  done(base(cid, rid), 'Arbetstiden är sparad');
}
export async function bookFou(cid: number, rid: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'payroll' }));
  let a = 0;
  await attempt(base(cid, rid), async () => { a = await svc.book(actor, rid); });
  done(base(cid, rid), `Forskningsavdraget ${kr(a)} kr är bokfört – arbetsgivaravgifterna minskar`);
}
