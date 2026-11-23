'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/franchise';

const base = (cid: number) => `/c/${cid}/franchise`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function franchiseeAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  let r: { id: number; invoiceId: number | null } = { id: 0, invoiceId: null };
  await attempt(base(cid), async () => { r = await svc.addFranchisee(actor, form(fd)); });
  done(r.invoiceId ? `/c/${cid}/fakturor/${r.invoiceId}` : base(cid), r.invoiceId ? 'Avtalet är upplagt – fakturautkast för inträdesavgiften är skapat' : 'Avtalet är upplagt');
}
export async function reportAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  let r: { royalty: number; marketing: number; invoiceId: number | null } = { royalty: 0, marketing: 0, invoiceId: null };
  await attempt(base(cid), async () => { r = await svc.report(actor, id, form(fd)); });
  done(r.invoiceId ? `/c/${cid}/fakturor/${r.invoiceId}` : base(cid), `Rapporten är registrerad: royalty ${kr(r.royalty)} kr, marknadsavgift ${kr(r.marketing)} kr`);
}
export async function recognizeAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let a = 0;
  await attempt(base(cid), async () => { a = await svc.recognize(actor, form(fd)); });
  done(base(cid), `${kr(a)} kr av inträdesavgifterna är intäktsförda`);
}
export async function fundAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let a = 0;
  await attempt(base(cid), async () => { a = await svc.useFund(actor, form(fd)); });
  done(base(cid), `${kr(a)} kr av marknadsföringsfonden är använt`);
}
