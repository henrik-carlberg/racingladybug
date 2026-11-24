'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/supplier-subscriptions';

const base = (cid: number) => `/c/${cid}/leverantorer/abonnemang`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function addAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'purchasing' }));
  await attempt(base(cid), async () => { await svc.add(actor, form(fd)); });
  done(base(cid), 'Abonnemanget är registrerat');
}
export async function seatsAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'purchasing' }));
  await attempt(base(cid), async () => { await svc.setSeats(actor, id, form(fd)); });
  done(base(cid), 'Licenserna är uppdaterade');
}
export async function cancelAction(cid: number, id: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'purchasing' }));
  let end = '';
  await attempt(base(cid), async () => { end = await svc.cancel(actor, id); });
  done(base(cid), `Abonnemanget är uppsagt och upphör ${end}`);
}
