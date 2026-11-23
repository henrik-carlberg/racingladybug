'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/events';

const base = (cid: number) => `/c/${cid}/evenemang`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function eventAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(base(cid), async () => { await svc.addEvent(actor, form(fd)); });
  done(base(cid), 'Evenemanget är upplagt');
}
export async function typeAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(base(cid), async () => { await svc.addTicketType(actor, id, form(fd)); });
  done(base(cid), 'Biljettypen är upplagd');
}
export async function sellAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  let a = 0;
  await attempt(base(cid), async () => { a = await svc.sell(actor, id, form(fd)); });
  done(base(cid), `Biljetter för ${kr(a)} kr är sålda och bokförda som förutbetald intäkt`);
}
export async function refundAction(cid: number, ticketId: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'payments' }));
  let a = 0;
  await attempt(base(cid), async () => { a = await svc.refund(actor, ticketId); });
  done(base(cid), `${kr(a)} kr är återbetalt`);
}
export async function sponsorAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  let inv = 0;
  await attempt(base(cid), async () => { inv = await svc.addSponsor(actor, id, form(fd)); });
  done(`/c/${cid}/fakturor/${inv}`, 'Fakturautkast för sponsringen är skapat');
}
export async function costAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(base(cid), async () => { await svc.linkCost(actor, id, form(fd)); });
  done(base(cid), 'Kostnaden är kopplad till evenemanget');
}
export async function finishAction(cid: number, id: number, kind: 'held' | 'cancelled') {
  const actor = userActor(await requireCompany(cid, { perm: kind === 'cancelled' ? 'payments' : 'ledger' }));
  let a = 0;
  await attempt(base(cid), async () => { a = await svc.finish(actor, id, kind); });
  done(base(cid), kind === 'held' ? `Evenemanget är genomfört – ${kr(a)} kr är intäktsfört` : `Evenemanget är inställt – ${kr(a)} kr är återbetalt`);
}
