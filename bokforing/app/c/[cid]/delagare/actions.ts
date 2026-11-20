'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as p from '@/lib/services/partnership';

const back = (cid: number) => `/c/${cid}/delagare`;
const obj = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
export async function save(cid: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { owner: true }));
  await attempt(back(cid), () => p.savePartners(a, obj(fd)));
  done(back(cid), 'Delägarna är sparade');
}
export async function transaction(cid: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid), () => p.ownerTransaction(a, obj(fd)));
  done(back(cid), fd.get('kind') === 'contribution' ? 'Insättningen är bokförd' : 'Uttaget är bokfört');
}
