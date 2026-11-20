'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/deficits';

const base = (cid: number) => `/c/${cid}/bokslut/underskott`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
export async function setTaxable(cid: number, fy: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(base(cid), () => svc.setTaxable(actor, fy, form(fd)));
  done(base(cid), 'Det skattemässiga resultatet är sparat');
}
export async function setChange(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(base(cid), () => svc.setChange(actor, form(fd)));
  done(base(cid), 'Ägarförändringen är sparad');
}
