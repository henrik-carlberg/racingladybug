'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { postDue } from '@/lib/services/revenue';

export async function post(cid: number) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let n = 0;
  await attempt(`/c/${cid}/intaktsplan`, async () => { n = await postDue(a); });
  done(`/c/${cid}/intaktsplan`, n ? `Periodiserade intäkter är bokförda för ${n} månader` : 'Det finns inga avslutade månader att bokföra');
}
