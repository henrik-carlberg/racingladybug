'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/sanctions';

const base = (cid: number) => `/c/${cid}/sanktionslistor`;
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'ledger' }));

export async function uploadAction(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  const file = fd.get('file');
  let r = { entries: 0, parties: 0, potential: 0 };
  await attempt(base(cid), async () => { r = await svc.upload(actor, String(fd.get('source') ?? ''), file instanceof File ? file : null); });
  done(base(cid), `Listan har ${r.entries} namn. ${r.parties} kunder och leverantörer är kontrollerade – ${r.potential} möjliga träffar att granska`);
}
export async function screenAction(cid: number) {
  const actor = await actorFor(cid);
  let r = { parties: 0, potential: 0 };
  await attempt(base(cid), async () => { r = await svc.screenAll(actor); });
  done(base(cid), `${r.parties} kunder och leverantörer är kontrollerade – ${r.potential} möjliga träffar att granska`);
}
export async function reviewAction(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  let d = '';
  await attempt(base(cid), async () => { d = await svc.review(actor, id, Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'))); });
  done(base(cid), d === 'confirmed' ? 'Träffen är bekräftad – fakturering och betalning är stoppad. Överväg rapport till Finanspolisen.' : 'Träffen är bedömd som falsk');
}
