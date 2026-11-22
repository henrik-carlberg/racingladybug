'use server';
import { redirect } from 'next/navigation';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/outlays';

const base = (cid: number) => `/c/${cid}/kundutlagg`;
export async function register(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(base(cid), () => svc.register(actor, Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]))));
  done(base(cid), 'Utlägget är bokfört som fordran på kunden');
}
export async function invoice(cid: number, customerId: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  let id = 0;
  await attempt(base(cid), async () => { id = await svc.invoiceOutlays(actor, customerId); });
  redirect(`/c/${cid}/fakturor/${id}?ok=${encodeURIComponent('Fakturautkast med utläggen är skapat')}`);
}
