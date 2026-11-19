'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/peppol';

export async function sendViaPeppol(cid: number, invoiceId: number) {
  const a = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  const back = `/c/${cid}/fakturor/${invoiceId}`;
  let s = { status: '', message: '' };
  await attempt(back, async () => { s = await svc.sendInvoice(a, invoiceId); });
  if (s.status === 'failed') done(back, `Åtkomstpunkten avvisade fakturan: ${s.message}`);
  done(back, s.status === 'delivered' ? 'E-fakturan är levererad till kunden' : 'E-fakturan är skickad via Peppol – leveransstatus uppdateras automatiskt');
}
export async function refreshPeppol(cid: number, back: string) {
  const ctx = await requireCompany(cid, { perm: 'invoicing' });
  const safe = back.startsWith(`/c/${cid}/`) ? back : `/c/${cid}/peppol`;
  let n = 0;
  await attempt(safe, async () => { n = await svc.refreshStatuses(ctx.company.id); });
  done(safe, n ? `${n} leveransstatus uppdaterad` : 'Ingen ny leveransstatus');
}
export async function lookupCustomer(cid: number, customerId: number) {
  const a = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  const back = `/c/${cid}/kunder/${customerId}`;
  let r: { id: string; registered: boolean; canReceiveInvoice: boolean; name?: string } = { id: '', registered: false, canReceiveInvoice: false };
  await attempt(back, async () => { r = await svc.lookupCustomer(a, customerId); });
  done(back, !r.registered ? `${r.id} finns inte i Peppol – skicka fakturan med e-post eller som PDF` : r.canReceiveInvoice ? `${r.name ?? 'Kunden'} tar emot e-faktura via Peppol (${r.id}) – sparat på kunden` : `${r.id} finns i Peppol men tar inte emot fakturor`);
}
