'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/excise';

const base = (cid: number, period?: string) => `/c/${cid}/punktskatter${period ? `?period=${encodeURIComponent(period)}` : ''}`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const per = (fd: FormData) => String(fd.get('period') ?? '');

export async function addTypeAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(base(cid, per(fd)), async () => { await svc.addType(actor, form(fd)); });
  done(base(cid, per(fd)), 'Skatteslaget är upplagt');
}
export async function linkAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(base(cid, per(fd)), async () => { await svc.linkProduct(actor, form(fd)); });
  done(base(cid, per(fd)), 'Artikeln är kopplad till skatteslaget');
}
export async function entryAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(base(cid, per(fd)), async () => { await svc.addEntry(actor, form(fd)); });
  done(base(cid, per(fd)), 'Uttaget är registrerat');
}
export async function declareAction(cid: number, period: string) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let total = 0;
  await attempt(base(cid, period), async () => { total = (await svc.declare(actor, period)).total; });
  done(base(cid, period), `Punktskatten för ${period} är bokförd: ${kr(total)} kr på 2660`);
}
export async function payAction(cid: number, id: number, period: string, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'payments' }));
  let total = 0;
  await attempt(base(cid, period), async () => { total = await svc.pay(actor, id, form(fd)); });
  done(base(cid, period), `Betalningen av punktskatten är bokförd: ${kr(total)} kr till skattekontot`);
}
