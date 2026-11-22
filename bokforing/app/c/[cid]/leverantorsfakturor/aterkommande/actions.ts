'use server';
import { redirect } from 'next/navigation';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/recurring-supplier';

const base = (cid: number) => `/c/${cid}/leverantorsfakturor/aterkommande`;
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'purchasing' }));
export async function addTemplate(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), () => svc.addTemplate(actor, Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]))));
  done(base(cid), 'Mallen är sparad');
}
export async function create(cid: number, templateId: number, period: string) {
  const actor = await actorFor(cid);
  let id = 0;
  await attempt(base(cid), async () => { id = await svc.createFromTemplate(actor, templateId, period); });
  redirect(`/c/${cid}/leverantorsfakturor/${id}?ok=${encodeURIComponent(`Fakturan för ${period} är registrerad från mallen och väntar på attest`)}`);
}
export async function toggle(cid: number, templateId: number, active: boolean) {
  const actor = await actorFor(cid);
  await attempt(base(cid), () => svc.setActive(actor, templateId, active));
  done(base(cid), active ? 'Mallen är aktiv' : 'Mallen är pausad');
}
