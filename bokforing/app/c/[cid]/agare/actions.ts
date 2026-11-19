'use server';
import { amount, attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/owners';

const base = (cid: number) => `/c/${cid}/agare`;
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'ledger' }));

export async function saveOwner(cid: number, id: number | null, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), () => svc.saveOwner(actor, id, { name: str(fd, 'name'), personal_number: str(fd, 'personal_number'), share_pct: str(fd, 'share_pct'), cost_basis: amount(fd, 'cost_basis', 'Omkostnadsbelopp'), saved_space: amount(fd, 'saved_space', 'Sparat utdelningsutrymme') }));
  done(base(cid), 'Ägaren är sparad');
}
export async function removeOwner(cid: number, id: number) {
  const actor = await actorFor(cid);
  await attempt(base(cid), () => svc.removeOwner(actor, id));
  done(base(cid), 'Ägaren är borttagen');
}
export async function decide(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(`${base(cid)}#utdelning`, () => svc.decideDividend(actor, { amount: amount(fd, 'amount'), date: str(fd, 'date') }));
  done(`${base(cid)}#utdelning`, 'Utdelningen är bokförd som beslutad (2091 → 2898)');
}
export async function pay(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(`${base(cid)}#utdelning`, () => svc.payDividend(actor, { amount: amount(fd, 'amount'), date: str(fd, 'date'), bank_account: str(fd, 'bank_account') }));
  done(`${base(cid)}#utdelning`, 'Utdelningen är utbetald och bokförd');
}
