'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/property-tax';

const base = (cid: number) => `/c/${cid}/fastighet/skatt`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
export async function addProperty(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(base(cid), () => svc.addProperty(actor, form(fd)));
  done(base(cid), 'Fastigheten är upplagd');
}
export async function bookTax(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let r = { total: 0, months: 0 };
  await attempt(base(cid), async () => { r = await svc.bookTax(actor, id, form(fd)); });
  done(base(cid), `Fastighetsskatt ${kr(r.total)} kr för ${r.months} månader är bokförd`);
}
export async function sellProperty(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let r = { result: 0, tax: { gain: 0 } };
  await attempt(base(cid), async () => { r = await svc.sellProperty(actor, id, form(fd)); });
  done(base(cid), `Försäljningen är bokförd: ${r.result >= 0 ? 'vinst' : 'förlust'} ${kr(Math.abs(r.result))} kr i bokföringen, skattepliktig vinst ${kr(r.tax.gain)} kr`);
}
