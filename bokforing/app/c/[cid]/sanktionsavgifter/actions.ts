'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/penalties';

const base = (cid: number) => `/c/${cid}/sanktionsavgifter`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function addAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let r = { amount: 0, account: 0 };
  await attempt(base(cid), async () => { r = await svc.add(actor, form(fd)); });
  done(base(cid), `Avgiften ${kr(r.amount)} kr är bokförd på ${r.account} (ej avdragsgill)`);
}
export async function reviewAction(cid: number, voucherId: number, account: number, action: 'reclassed' | 'ignored') {
  if (action !== 'reclassed' && action !== 'ignored') throw new Error('Ogiltig åtgärd');
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let a = 0;
  await attempt(base(cid), async () => { a = await svc.review(actor, voucherId, account, action); });
  done(base(cid), action === 'reclassed' ? `${kr(a)} kr är omfört till 6992` : 'Raden är markerad som granskad');
}
