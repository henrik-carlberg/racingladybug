'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { matchCardReceipts, setCard } from '@/lib/services/cards';

const back = (cid: number) => `/c/${cid}/kort`;

export async function saveCard(cid: number, accountId: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { owner: true, perm: 'ledger' }));
  await attempt(back(cid), () => setCard(actor, accountId, fd.get('is_card') === 'on', Number(str(fd, 'holder')) || null));
  done(back(cid), 'Kortkontot är sparat');
}

export async function match(cid: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let n = 0;
  await attempt(back(cid), async () => { n = await matchCardReceipts(actor); });
  done(back(cid), n ? `${n} kortköp kopplades till kvitton` : 'Inga nya kvitton att koppla');
}
