'use server';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { attempt, done } from '@/lib/server/action';
import { transfer } from '@/lib/services/sales-forecast';

export async function transferAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const path = `/c/${cid}/forsaljningsprognos`;
  let n = 0;
  await attempt(path, async () => { n = await transfer(actor, Number(fd.get('vat') ?? 25)); });
  done(path, `${n} poster är överförda till likviditetsprognosen`);
}
