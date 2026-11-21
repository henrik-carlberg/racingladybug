'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/small-assets';

const base = (cid: number, y: number) => `/c/${cid}/anlaggningar/direktavdrag?ar=${y}`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
export async function keep(cid: number, year: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(base(cid, year), () => svc.keep(actor, id, form(fd)));
  done(base(cid, year), 'Direktavdraget behålls och bedömningen är sparad');
}
export async function activate(cid: number, year: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let r = { assetId: 0, amount: 0 };
  await attempt(base(cid, year), async () => { r = await svc.activate(actor, id, form(fd)); });
  done(base(cid, year), `Inventariet (${kr(r.amount)} kr) är aktiverat och upplagt i anläggningsregistret`);
}
