'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/ip-rights';

const base = (cid: number) => `/c/${cid}/immateriella-rattigheter`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function addAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let r = { id: 0, renewalDate: null as string | null };
  await attempt(base(cid), async () => { r = await svc.add(actor, form(fd)); });
  done(base(cid), `Rättigheten är registrerad${r.renewalDate ? ` – förnyas ${r.renewalDate}` : ''}`);
}
export async function costAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let r = { how: 'expensed', account: 0, renewedTo: null as string | null };
  await attempt(base(cid), async () => { r = await svc.addCost(actor, id, form(fd)); });
  done(base(cid), `${r.how === 'capitalized' ? `Utgiften är aktiverad på ${r.account} och lagd i anläggningsregistret` : `Utgiften är kostnadsförd på ${r.account}`}${r.renewedTo ? `. Nästa förnyelse ${r.renewedTo}` : ''}`);
}
export async function lapseAction(cid: number, id: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(base(cid), async () => { await svc.lapse(actor, id); });
  done(base(cid), 'Rättigheten är markerad som upphörd');
}
