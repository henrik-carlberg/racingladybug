'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { setSimplification } from '@/lib/services/interest-limit';

export async function saveSimplification(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const back = `/c/${cid}/bokslut/ranteavdrag`;
  await attempt(back, () => setSimplification(actor, { simplification: String(fd.get('simplification') ?? '') }));
  done(back, 'Andelen av förenklingsbeloppet är sparad');
}
