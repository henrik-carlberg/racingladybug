'use server';
import { amount, attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/owners';

const base = (cid: number) => `/c/${cid}/agare`;
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'ledger' }));

export async function saveOwner(cid: number, id: number | null, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), () => svc.saveOwner(actor, id, { name: str(fd, 'name'), personal_number: str(fd, 'personal_number'), share_pct: str(fd, 'share_pct'), cost_basis: amount(fd, 'cost_basis', 'Omkostnadsbelopp'), saved_space: amount(fd, 'saved_space', 'Sparat utdelningsutrymme') }));
  done(base(cid), 'Ägaren är sparad');
}
export async function removeOwner(cid: number, id: number) {
  const actor = await actorFor(cid);
  await attempt(base(cid), () => svc.removeOwner(actor, id));
  done(base(cid), 'Ägaren är borttagen');
}
export async function decide(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(`${base(cid)}#utdelning`, () => svc.decideDividend(actor, { amount: amount(fd, 'amount'), date: str(fd, 'date') }));
  done(`${base(cid)}#utdelning`, 'Utdelningen är bokförd som beslutad (2091 → 2898)');
}
export async function pay(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(`${base(cid)}#utdelning`, () => svc.payDividend(actor, { amount: amount(fd, 'amount'), date: str(fd, 'date'), bank_account: str(fd, 'bank_account') }));
  done(`${base(cid)}#utdelning`, 'Utdelningen är utbetald och bokförd');
}

import * as ch from '@/lib/services/closely-held';
export async function saveK10(cid: number, year: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await requireCompany(cid, { perm: 'payroll' });
  const back = `${base(cid)}?year=${year}#k10`;
  let n = 0;
  await attempt(back, async () => { n = await ch.saveK10(actor, year); });
  done(back, `K10 för ${year} är sparad för ${n} ägare – det sparade utdelningsutrymmet förs till ${year + 1}`);
}
export async function createInsurance(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(`${base(cid)}#kapitalforsakring`, () => ch.createInsurance(actor, Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'))));
  done(`${base(cid)}#kapitalforsakring`, 'Kapitalförsäkringen är registrerad');
}
export async function premium(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(`${base(cid)}#kapitalforsakring`, () => ch.premium(actor, id, { amount: str(fd, 'amount'), date: str(fd, 'date'), bank_account: str(fd, 'bank_account') }));
  done(`${base(cid)}#kapitalforsakring`, 'Premien är bokförd på 1385');
}
export async function insuranceValue(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  let w = 0;
  await attempt(`${base(cid)}#kapitalforsakring`, async () => { w = (await ch.registerValue(actor, id, { value: str(fd, 'value'), date: str(fd, 'date'), writedown: fd.get('writedown') === 'on' ? 'on' : '' })).writedown; });
  done(`${base(cid)}#kapitalforsakring`, w ? 'Värdet är registrerat och nedskrivningen bokförd' : 'Värdet är registrerat');
}
