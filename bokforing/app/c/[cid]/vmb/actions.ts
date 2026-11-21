'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/vmb';

const base = (cid: number) => `/c/${cid}/vmb`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'ledger' }));
export async function purchase(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), () => svc.purchase(actor, form(fd)));
  done(base(cid), 'Inköpet är bokfört');
}
export async function sale(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  await attempt(base(cid), () => svc.sale(actor, form(fd)));
  done(base(cid), 'Försäljningen är bokförd');
}
export async function settle(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  let r = { margin: 0, vat: 0, base: 0, carryOut: 0 };
  await attempt(base(cid), async () => { r = await svc.settlePeriod(actor, form(fd)); });
  done(base(cid), r.vat ? `Marginalen är ${kr(r.margin)} kr: moms ${kr(r.vat)} kr, beskattningsunderlag ${kr(r.base)} kr i ruta 07` : `Negativ marginal ${kr(r.carryOut)} kr förs över till nästa period`);
}
