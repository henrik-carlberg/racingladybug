'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/share-instruments';

const base = (cid: number) => `/c/${cid}/aktiebok/instrument`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function issueAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let r = { id: 0, shares: 0 };
  await attempt(base(cid), async () => { r = await svc.issue(actor, form(fd)); });
  done(base(cid), `Instrumentet är registrerat – ger rätt till ${r.shares} aktier`);
}
export async function accrueAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let a = 0;
  await attempt(base(cid), async () => { a = await svc.accrue(actor, id, form(fd)); });
  done(base(cid), `Upplupen ränta ${kr(a)} kr är bokförd`);
}
export async function convertAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let r = { shares: 0, capital: 0, from: 0, to: 0 };
  await attempt(base(cid), async () => { r = await svc.convert(actor, id, form(fd)); });
  done(base(cid), `${r.shares} nya aktier (nr ${r.from}–${r.to}) är införda i aktieboken och aktiekapitalet har ökat med ${kr(r.capital)} kr`);
}
export async function closeAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let k = '';
  await attempt(base(cid), async () => { k = await svc.close(actor, id, form(fd)); });
  done(base(cid), k === 'convertible' ? 'Lånet är återbetalt' : 'Optionerna har förfallit');
}
