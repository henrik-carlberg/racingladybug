'use server';
import { redirect } from 'next/navigation';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/tax-interest';

const back = (cid: number, period?: string) => `/c/${cid}/skattekonto/ranta${period ? `?period=${encodeURIComponent(period)}` : ''}`;
const obj = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function showAction(cid: number, fd: FormData) {
  await requireCompany(cid, { perm: 'ledger' });
  const p = String(fd.get('period') ?? '');
  redirect(back(cid, /^\d{4}-\d{2}$/.test(p) ? p : undefined));
}

export async function rateAction(cid: number, period: string, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let v = 0;
  await attempt(back(cid, period), async () => { v = await svc.setBaseRate(actor, obj(fd)); });
  done(back(cid, period), `Basräntan är ${(v / 100).toLocaleString('sv-SE')} %`);
}

export async function bookAction(cid: number, period: string) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let r = { cost: 0, income: 0 };
  await attempt(back(cid, period), async () => { r = await svc.bookInterest(actor, period); });
  done(back(cid, period), `Räntan för ${period} är bokförd: kostnadsränta ${kr(r.cost)} kr, intäktsränta ${kr(r.income)} kr`);
}

export async function addDeferralAction(cid: number, period: string, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid, period), () => svc.addDeferral(actor, obj(fd)));
  done(back(cid, period), 'Anståndet är registrerat');
}

export async function endDeferralAction(cid: number, period: string, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid, period), () => svc.endDeferral(actor, id, obj(fd)));
  done(back(cid, period), 'Anståndet är avslutat');
}
