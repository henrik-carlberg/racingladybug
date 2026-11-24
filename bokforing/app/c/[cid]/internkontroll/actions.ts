'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/internal-control';

const base = (cid: number) => `/c/${cid}/internkontroll`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'ledger' }));

export async function riskAction(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.addRisk(actor, form(fd)); });
  done(base(cid), 'Risken är tillagd');
}
export async function controlAction(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), async () => { await svc.addControl(actor, form(fd)); });
  done(base(cid), 'Kontrollen är tillagd');
}
export async function performAction(cid: number, controlId: number, fd: FormData) {
  const actor = await actorFor(cid);
  let r = { period: '', ok: true };
  await attempt(base(cid), async () => { r = await svc.perform(actor, controlId, form(fd)); });
  done(base(cid), r.ok ? `Kontrollen för ${r.period} är utförd utan avvikelse` : `Kontrollen för ${r.period} är utförd – avvikelsen är dokumenterad`);
}
