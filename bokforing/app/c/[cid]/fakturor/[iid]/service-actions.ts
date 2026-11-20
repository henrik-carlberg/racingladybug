'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { setServicePeriod } from '@/lib/services/revenue';

export async function servicePeriod(cid: number, invoiceId: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  let r: Awaited<ReturnType<typeof setServicePeriod>> = null;
  await attempt(`/c/${cid}/fakturor/${invoiceId}`, async () => { r = await setServicePeriod(actor, invoiceId, { service_from: fd.get('service_from'), service_to: fd.get('service_to') }); });
  const res = r as { deferred: number; months: number } | null;
  done(`/c/${cid}/fakturor/${invoiceId}`, res ? `Fakturan är periodiserad över ${res.months} månader` : 'Tjänsteperioden är sparad – intäkten periodiseras när fakturan bokförs');
}
