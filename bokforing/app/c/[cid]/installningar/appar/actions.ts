'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { disconnect } from '@/lib/services/oauth';

export async function disconnectApp(cid: number, grantId: number) {
  const a = userActor(await requireCompany(cid, { owner: true }));
  await attempt(`/c/${cid}/installningar/appar`, () => disconnect(a, grantId));
  done(`/c/${cid}/installningar/appar`, 'Appen är bortkopplad – dess åtkomst och prenumerationer har upphört');
}
