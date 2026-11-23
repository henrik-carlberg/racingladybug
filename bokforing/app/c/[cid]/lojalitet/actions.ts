'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/loyalty';

const base = (cid: number) => `/c/${cid}/lojalitet`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function settingsAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(base(cid), async () => { await svc.saveSettings(actor, form(fd)); });
  done(base(cid), 'Programmet är sparat');
}
export async function enrollAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(base(cid), async () => { await svc.enroll(actor, form(fd)); });
  done(base(cid), 'Kunden är medlem');
}
export async function collectAction(cid: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  let r = { points: 0, count: 0 };
  await attempt(base(cid), async () => { r = await svc.collect(actor); });
  done(base(cid), `${r.points} poäng har registrerats från ${r.count} fakturor`);
}
export async function redeemAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  let id = 0;
  await attempt(base(cid), async () => { id = await svc.redeem(actor, form(fd)); });
  done(`/c/${cid}/fakturor/${id}`, 'Kreditfakturautkast för inlösta poäng är skapat – granska och bokför');
}
export async function expireAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  let n = 0;
  await attempt(base(cid), async () => { n = await svc.expire(actor, form(fd)); });
  done(base(cid), n ? `${n} poäng har förfallit` : 'Inga poäng har förfallit');
}
export async function accrueAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let r = { target: 0, change: 0 };
  await attempt(base(cid), async () => { r = await svc.accrue(actor, form(fd)); });
  done(base(cid), `Skulden för bonuspoäng är justerad till ${kr(r.target)} kr (${r.change > 0 ? '+' : ''}${kr(r.change)} kr)`);
}
