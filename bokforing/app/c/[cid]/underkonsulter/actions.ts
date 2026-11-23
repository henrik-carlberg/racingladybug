'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/subcontractors';

const base = (cid: number) => `/c/${cid}/underkonsulter`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const h = (n: number) => n.toLocaleString('sv-SE');

export async function assignmentAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(base(cid), async () => { await svc.addAssignment(actor, form(fd)); });
  done(base(cid), 'Uppdraget är upplagt');
}
export async function reportAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(base(cid), async () => { await svc.report(actor, id, form(fd)); });
  done(base(cid), 'Tiden är registrerad');
}
export async function invoiceAction(cid: number, periodId: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  let inv = 0;
  await attempt(base(cid), async () => { inv = await svc.invoice(actor, periodId); });
  done(`/c/${cid}/fakturor/${inv}`, 'Fakturautkast för vidarefaktureringen är skapat');
}
export async function matchAction(cid: number, periodId: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'purchasing' }));
  let r = { invoiced: 0, reported: 0, diff: 0 };
  await attempt(base(cid), async () => { r = await svc.matchSupplierInvoice(actor, periodId, form(fd)); });
  done(base(cid), r.diff ? `Fakturan motsvarar ${h(r.invoiced)} timmar – ${h(Math.abs(r.diff))} timmar ${r.diff > 0 ? 'mer' : 'mindre'} än rapporterat` : `Fakturan stämmer med de rapporterade ${h(r.reported)} timmarna`);
}
