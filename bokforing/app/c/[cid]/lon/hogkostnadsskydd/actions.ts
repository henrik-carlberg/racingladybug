'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import { bookClaim } from '@/lib/services/sick-pay';

export async function bookSickClaim(cid: number, y: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'payroll' }));
  const back = `/c/${cid}/lon/hogkostnadsskydd?year=${y}`;
  let a = 0;
  await attempt(back, async () => { a = await bookClaim(actor, y); });
  done(back, `Fordran på Försäkringskassan ${kr(a)} kr är bokförd`);
}
