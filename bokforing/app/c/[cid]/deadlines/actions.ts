'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { markDeadline } from '@/lib/services/deadlines';

export async function mark(cid: number, key: string, isDone: boolean) {
  const actor = userActor(await requireCompany(cid));
  await attempt(`/c/${cid}/deadlines`, () => markDeadline(actor, key, isDone));
  done(`/c/${cid}/deadlines`);
}
