'use server';
import { amount, attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { isModuleEnabled } from '@/lib/modules/enabled';
import { userActor } from '@/lib/services/actor';
import * as svc from './service';

async function ctx(cid: number) {
  const c = await requireCompany(cid);
  if (!(await isModuleEnabled(c.company.id, 'arbetsorder'))) throw new Error('Arbetsordermodulen är inte aktiverad');
  return userActor(c);
}
const base = (cid: number) => `/c/${cid}/m/arbetsorder`;

export async function create(cid: number, fd: FormData) {
  const actor = await ctx(cid);
  let id = 0;
  await attempt(base(cid), async () => {
    id = await svc.createOrder(actor, { customer_id: str(fd, 'customer_id'), title: str(fd, 'title'), description: str(fd, 'description'), address: str(fd, 'address'),
      scheduled_date: str(fd, 'scheduled_date'), assignee_user_id: str(fd, 'assignee_user_id') || undefined });
  });
  done(`${base(cid)}/o/${id}`, 'Arbetsordern är skapad');
}

export async function save(cid: number, id: number, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(`${base(cid)}/o/${id}`, () => svc.update(actor, id, {
    title: str(fd, 'title'), description: str(fd, 'description'), address: str(fd, 'address'), scheduled_date: str(fd, 'scheduled_date'),
    assignee_user_id: str(fd, 'assignee_user_id') || undefined, report: str(fd, 'report'), status: str(fd, 'status'),
  }));
  done(`${base(cid)}/o/${id}`, 'Arbetsordern är sparad');
}

export async function addItem(cid: number, id: number, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(`${base(cid)}/o/${id}`, () => svc.addItem(actor, id, {
    kind: str(fd, 'kind'), description: str(fd, 'description'), quantity: str(fd, 'quantity'), unit: str(fd, 'unit'),
    unit_price: amount(fd, 'unit_price', 'À-pris') ?? 0, vat_rate: str(fd, 'vat_rate'), date: str(fd, 'date'), approved_by: str(fd, 'approved_by'),
  }));
  done(`${base(cid)}/o/${id}`, 'Raden är tillagd');
}

export async function removeItem(cid: number, id: number, itemId: number) {
  const actor = await ctx(cid);
  await attempt(`${base(cid)}/o/${id}`, () => svc.removeItem(actor, id, itemId));
  done(`${base(cid)}/o/${id}`, 'Raden är borttagen');
}

export async function sign(cid: number, id: number, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(`${base(cid)}/o/${id}`, () => svc.sign(actor, id, str(fd, 'signed_by')));
  done(`${base(cid)}/o/${id}`, 'Arbetet är godkänt av kunden');
}

export async function invoice(cid: number, id: number) {
  const actor = await ctx(cid);
  let inv = 0;
  await attempt(`${base(cid)}/o/${id}`, async () => { inv = await svc.invoiceOrder(actor, id); });
  done(`/c/${cid}/fakturor/${inv}`, 'Fakturautkast skapat från arbetsordern');
}
