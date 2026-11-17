'use server';
import { amount, attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { isModuleEnabled } from '@/lib/modules/enabled';
import { userActor } from '@/lib/services/actor';
import * as svc from './service';

async function ctx(cid: number) {
  const c = await requireCompany(cid);
  if (!(await isModuleEnabled(c.company.id, 'resurser'))) throw new Error('Resursbokningsmodulen är inte aktiverad');
  return userActor(c);
}
const base = (cid: number) => `/c/${cid}/m/resurser`;

export async function saveResource(cid: number, id: number | null, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(`${base(cid)}/resurser`, () => svc.saveResource(actor, id, {
    name: str(fd, 'name'), kind: str(fd, 'kind'), description: str(fd, 'description'), location: str(fd, 'location'), capacity: str(fd, 'capacity'),
    price_hour: amount(fd, 'price_hour', 'Timpris') ?? 0, price_day: amount(fd, 'price_day', 'Dagpris') ?? 0, vat_rate: str(fd, 'vat_rate'),
    open_from: str(fd, 'open_from'), open_to: str(fd, 'open_to'), requires_approval: fd.get('requires_approval') === 'on', active: id ? fd.get('active') === 'on' : true,
  }));
  done(`${base(cid)}/resurser`, id ? 'Resursen är sparad' : 'Resursen är upplagd');
}

export async function book(cid: number, back: string, fd: FormData) {
  const actor = await ctx(cid);
  let n = 0, pending = false;
  await attempt(back, async () => {
    const r = await svc.createBooking(actor, {
      resource_id: str(fd, 'resource_id'), date: str(fd, 'date'), end_date: str(fd, 'end_date'), from: str(fd, 'from'), to: str(fd, 'to'), title: str(fd, 'title'),
      customer_id: str(fd, 'customer_id'), project_id: str(fd, 'project_id'), billable: fd.get('billable') === 'on', repeat_weeks: str(fd, 'repeat_weeks'), notes: str(fd, 'notes'),
    });
    n = r.length; pending = r[0]?.status === 'pending';
  });
  done(back, `${n > 1 ? `${n} bokningar är gjorda` : 'Bokningen är gjord'}${pending ? ' och väntar på godkännande' : ''}`);
}

export async function setStatus(cid: number, id: number, status: 'confirmed' | 'cancelled', series: boolean, back: string) {
  const actor = await ctx(cid);
  let n = 0;
  await attempt(back, async () => { n = await svc.setStatus(actor, id, status, series); });
  done(back, status === 'confirmed' ? 'Bokningen är godkänd' : `${n > 1 ? `${n} bokningar är avbokade` : 'Bokningen är avbokad'}`);
}

export async function invoice(cid: number, fd: FormData) {
  const actor = await ctx(cid);
  let id = 0;
  await attempt(`${base(cid)}/rapport`, async () => { id = (await svc.invoiceBookings(actor, { customer_id: str(fd, 'customer_id'), to: str(fd, 'to') })).id; });
  done(`/c/${cid}/fakturor/${id}`, 'Fakturautkastet för bokningarna är skapat');
}
