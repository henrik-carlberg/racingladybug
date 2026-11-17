'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { toggleAccount as toggle, upsertAccount } from '@/lib/services/accounts';

export async function addAccount(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  await attempt(`/c/${cid}/konton`, () => upsertAccount(actor, { number: str(fd, 'number'), name: str(fd, 'name') }));
  done(`/c/${cid}/konton`, 'Kontot är sparat');
}

export async function toggleAccount(cid: number, n: number) {
  const actor = userActor(await requireCompany(cid));
  await attempt(`/c/${cid}/konton`, () => toggle(actor, n));
  done(`/c/${cid}/konton`);
}
