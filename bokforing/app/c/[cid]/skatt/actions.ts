'use server';
import { amount, attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { bookAppropriation, savePrelim } from '@/lib/services/tax-planning';

export async function prelim(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(`/c/${cid}/skatt`, () => savePrelim(actor, amount(fd, 'monthly', 'Preliminärskatt') ?? 0));
  done(`/c/${cid}/skatt`, 'Debiterad preliminärskatt är sparad');
}

export async function appropriate(cid: number, fyId: number, kind: string) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const back = `/c/${cid}/bokslut/${fyId}/dispositioner`;
  await attempt(back, () => bookAppropriation(actor, fyId, kind));
  done(back, 'Dispositionen är bokförd per bokslutsdagen');
}
