'use server';
import { redirect } from 'next/navigation';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/consignment';

const base = (cid: number) => `/c/${cid}/konsignation`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'invoicing' }));
export async function addItem(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), () => svc.addItem(actor, form(fd)));
  done(base(cid), 'Artikeln är upplagd hos återförsäljaren');
}
export async function move(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  let r = { invoiceId: null as number | null, left: 0 };
  await attempt(base(cid), async () => { r = await svc.move(actor, id, form(fd)); });
  if (r.invoiceId) redirect(`/c/${cid}/fakturor/${r.invoiceId}?ok=${encodeURIComponent(`Fakturautkast för den sålda konsignationen är skapat – kvar hos återförsäljaren: ${r.left} st`)}`);
  done(base(cid), `Bokfört – kvar hos återförsäljaren: ${r.left} st`);
}
