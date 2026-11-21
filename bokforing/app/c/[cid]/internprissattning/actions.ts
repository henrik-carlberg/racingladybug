'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/transfer-pricing';

const form = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
export async function addTransaction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const back = `/c/${cid}/internprissattning?year=${String(fd.get('year') ?? '')}`;
  await attempt(back, () => svc.addTransaction(actor, form(fd)));
  done(back, 'Transaktionen är registrerad');
}
export async function documentTransaction(cid: number, id: number, year: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const back = `/c/${cid}/internprissattning?year=${year}`;
  await attempt(back, () => svc.document(actor, id, form(fd)));
  done(back, 'Dokumentationen är sparad');
}
