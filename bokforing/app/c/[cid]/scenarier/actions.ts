'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/scenarios';

const base = (cid: number, year?: string) => `/c/${cid}/scenarier${year ? `?year=${year}` : ''}`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const yr = (fd: FormData) => String(fd.get('year') ?? '').replace(/\D/g, '') || undefined;

export async function scenarioAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(base(cid, yr(fd)), async () => { await svc.addScenario(actor, form(fd)); });
  done(base(cid, yr(fd)), 'Scenariot är skapat');
}
export async function itemAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(base(cid, yr(fd)), async () => { await svc.addItem(actor, id, form(fd)); });
  done(base(cid, yr(fd)), 'Förändringen är tillagd');
}
export async function removeAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(base(cid, yr(fd)), async () => { await svc.removeItem(actor, id); });
  done(base(cid, yr(fd)), 'Förändringen är borttagen');
}
