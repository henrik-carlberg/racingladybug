'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/owner-loans';

const base = (cid: number) => `/c/${cid}/lan-till-agare`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
export async function addLoan(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(base(cid), () => svc.addLoan(actor, form(fd)));
  done(base(cid), 'Lånet är registrerat');
}
export async function settleLoan(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let a = 0;
  await attempt(base(cid), async () => { a = await svc.settle(actor, id, form(fd)); });
  done(base(cid), `${kr(a)} kr av lånet är reglerat`);
}
