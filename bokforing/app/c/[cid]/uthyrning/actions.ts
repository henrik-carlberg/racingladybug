'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/rental';

const base = (cid: number) => `/c/${cid}/uthyrning`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const toInvoice = (cid: number, id: number | null, msg: string) => done(id ? `/c/${cid}/fakturor/${id}` : base(cid), msg);

export async function itemAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(base(cid), async () => { await svc.addItem(actor, form(fd)); });
  done(base(cid), 'Utrustningen är upplagd');
}
export async function checkoutAction(cid: number, itemId: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(base(cid), async () => { await svc.checkout(actor, itemId, form(fd)); });
  done(base(cid), 'Utrustningen är utlämnad');
}
export async function checkinAction(cid: number, contractId: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  let r: { invoiceId: number | null } = { invoiceId: null };
  await attempt(base(cid), async () => { r = await svc.checkin(actor, contractId, form(fd)); });
  toInvoice(cid, r.invoiceId, r.invoiceId ? 'Utrustningen är återlämnad – fakturautkast för hyran är skapat' : 'Utrustningen är återlämnad');
}
export async function invoiceAction(cid: number, contractId: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  let r: { invoiceId: number | null } = { invoiceId: null };
  await attempt(base(cid), async () => { r = await svc.invoiceContract(actor, contractId, form(fd)); });
  toInvoice(cid, r.invoiceId, 'Fakturautkast för hyran är skapat');
}
