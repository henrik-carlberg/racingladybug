'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/service-cases';

const base = (cid: number) => `/c/${cid}/service`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function openAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  let r = { id: 0, inWarranty: false };
  await attempt(base(cid), async () => { r = await svc.open(actor, form(fd)); });
  done(base(cid), `Ärende ${r.id} är registrerat – ${r.inWarranty ? 'inom garantin' : 'utanför garantin'}`);
}
export async function lineAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(base(cid), async () => { await svc.addLine(actor, id, form(fd)); });
  done(base(cid), 'Raden är tillagd');
}
export async function closeAction(cid: number, id: number, fd: FormData) {
  const input = form(fd);
  // Att ta i anspråk ur avsättningen bokför i huvudboken och kräver bokföringsbehörighet
  const actor = userActor(await requireCompany(cid, { perm: input.provision_id ? 'ledger' : 'invoicing' }));
  let r: { total: number; used: number; invoiceId: number | null; inWarranty: boolean } = { total: 0, used: 0, invoiceId: null, inWarranty: false };
  await attempt(base(cid), async () => { r = await svc.close(actor, id, input); });
  if (r.invoiceId) done(`/c/${cid}/fakturor/${r.invoiceId}`, 'Ärendet är avslutat – fakturautkast för servicen är skapat');
  done(base(cid), r.inWarranty ? `Garantiärendet är avslutat: kostnad ${kr(r.total)} kr, varav ${kr(r.used)} kr ur garantiavsättningen` : 'Ärendet är avslutat');
}
