'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as a from '@/lib/services/allocation';

const back = (cid: number) => `/c/${cid}/kostnadsfordelning`;
const obj = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const actor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'ledger' }));
export async function key(cid: number, fd: FormData) { const x = await actor(cid); await attempt(back(cid), () => a.createKey(x, obj(fd))); done(back(cid), 'Fördelningsnyckeln är sparad'); }
export async function charge(cid: number, fd: FormData) { const x = await actor(cid); await attempt(back(cid), () => a.createCharge(x, obj(fd))); done(back(cid), 'Interndebiteringen är sparad'); }
export async function stop(cid: number, kind: 'key' | 'charge', id: number) { const x = await actor(cid); await attempt(back(cid), () => a.deactivate(x, kind, id)); done(back(cid), 'Avslutad'); }
export async function run(cid: number, fd: FormData) {
  const x = await actor(cid);
  let n = 0;
  await attempt(back(cid), async () => { n = await a.runPeriod(x, String(fd.get('period') ?? '')); });
  done(`${back(cid)}?period=${encodeURIComponent(String(fd.get('period') ?? ''))}`, `${n} fördelningar och debiteringar är bokförda för ${fd.get('period')}`);
}
