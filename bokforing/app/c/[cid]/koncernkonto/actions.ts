'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/cash-pool';

const base = (cid: number, period?: string) => `/c/${cid}/koncernkonto${period ? `?period=${encodeURIComponent(period)}` : ''}`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const per = (fd: FormData) => String(fd.get('period') ?? '');

export async function createAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(base(cid, per(fd)), async () => { await svc.createPool(actor, form(fd)); });
  done(base(cid, per(fd)), 'Koncernkontot är upplagt');
}
export async function memberAction(cid: number, poolId: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(base(cid, per(fd)), async () => { await svc.addMember(actor, poolId, form(fd)); });
  done(base(cid, per(fd)), 'Dotterbolaget är anslutet till koncernkontot');
}
export async function sweepAction(cid: number, poolId: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let a = 0;
  await attempt(base(cid, per(fd)), async () => { a = await svc.sweep(actor, poolId, form(fd)); });
  done(base(cid, per(fd)), `Överföringen ${kr(Math.abs(a))} kr ${a > 0 ? 'till' : 'från'} huvudkontot är bokförd i båda bolagen`);
}
export async function interestAction(cid: number, poolId: number, period: string) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let r = { booked: 0, total: 0 };
  await attempt(base(cid, period), async () => { r = await svc.bookInterest(actor, poolId, period); });
  done(base(cid, period), `Internräntan för ${period} är bokförd för ${r.booked} bolag (netto ${kr(r.total)} kr till dotterbolagen)`);
}
