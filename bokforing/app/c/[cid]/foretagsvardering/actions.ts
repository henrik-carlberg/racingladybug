'use server';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { attempt, done } from '@/lib/server/action';
import { save, toggle } from '@/lib/services/valuation';

const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const path = (cid: number) => `/c/${cid}/foretagsvardering`;
const actorFor = async (cid: number) => { await requireCompany(cid, { perm: 'payroll' }); return userActor(await requireCompany(cid, { perm: 'ledger' })); };

export async function saveAction(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(path(cid), () => save(actor, form(fd)));
  done(path(cid), 'Värderingen är sparad');
}
export async function toggleAction(cid: number, key: string) {
  const actor = await actorFor(cid);
  await attempt(path(cid), () => toggle(actor, key));
  done(path(cid));
}
