'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/commission-sales';

const base = (cid: number, s?: number) => `/c/${cid}/kommission${s ? `?nota=${s}` : ''}`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function principalAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(base(cid), async () => { await svc.addPrincipal(actor, form(fd)); });
  done(base(cid), 'Huvudmannen är upplagd');
}
export async function receiveAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(base(cid), async () => { await svc.receive(actor, form(fd)); });
  done(base(cid), 'Varan är mottagen i kommission');
}
export async function sellAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  let s = { commission: 0, payable: 0, vat: 0 };
  await attempt(base(cid), async () => { s = await svc.sell(actor, id, form(fd)); });
  done(base(cid), `Försäljningen är bokförd: provision ${kr(s.commission)} kr, moms ${kr(s.vat)} kr, att redovisa till huvudmannen ${kr(s.payable)} kr`);
}
export async function returnAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(base(cid), async () => { await svc.giveBack(actor, id, form(fd)); });
  done(base(cid), 'Varan är återlämnad till huvudmannen');
}
export async function settleAction(cid: number, principalId: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'payments' }));
  let r = { id: 0, amount: 0 };
  await attempt(base(cid), async () => { r = await svc.settle(actor, principalId, form(fd)); });
  done(base(cid, r.id), `Avräkningen är bokförd och ${kr(r.amount)} kr betalas ut`);
}
