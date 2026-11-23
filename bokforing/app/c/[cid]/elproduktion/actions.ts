'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/power';

const base = (cid: number, year?: string) => `/c/${cid}/elproduktion${year ? `?year=${year}` : ''}`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const yr = (fd: FormData) => String(fd.get('year') ?? '').replace(/\D/g, '') || undefined;

export async function plantAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(base(cid), async () => { await svc.addPlant(actor, form(fd)); });
  done(base(cid), 'Anläggningen är upplagd');
}
export async function monthAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let r = { amount: 0, sold: 0 };
  await attempt(base(cid, yr(fd)), async () => { r = await svc.addMonth(actor, id, form(fd)); });
  done(base(cid, yr(fd)), r.amount ? `Månaden är registrerad och försäljningen ${kr(r.amount)} kr exkl. moms är bokförd` : 'Månaden är registrerad');
}
export async function certAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let a = 0;
  await attempt(base(cid, yr(fd)), async () => { a = await svc.sellCertificates(actor, id, form(fd)); });
  done(base(cid, yr(fd)), `Försäljningen ${kr(a)} kr exkl. moms är bokförd`);
}
