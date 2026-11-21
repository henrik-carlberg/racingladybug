'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/intrastat';

const base = (cid: number, p: string) => `/c/${cid}/intrastat?period=${encodeURIComponent(p)}`;
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'ledger' }));
export async function addLine(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  const input = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
  await attempt(base(cid, input.period), () => svc.addLine(actor, input));
  done(base(cid, input.period), 'Raden är tillagd');
}
export async function deleteLine(cid: number, period: string, id: number) {
  const actor = await actorFor(cid);
  await attempt(base(cid, period), () => svc.deleteLine(actor, id));
  done(base(cid, period), 'Raden är borttagen');
}
