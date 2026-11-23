'use server';
import { attempt, done as finish } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/bookings';

const base = (cid: number, d?: string) => `/c/${cid}/tidsbokning${d ? `?date=${encodeURIComponent(d)}` : ''}`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const day = (fd: FormData) => String(fd.get('view_date') ?? '') || undefined;

export async function settingsAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(base(cid), async () => { await svc.saveSettings(actor, form(fd)); });
  finish(base(cid), 'Inställningarna är sparade');
}
export async function serviceAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(base(cid), async () => { await svc.addService(actor, form(fd)); });
  finish(base(cid), 'Tjänsten är upplagd');
}
export async function bookAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  let r = { date: '', time: '', service: '' };
  await attempt(base(cid, day(fd)), async () => { r = await svc.book(actor, form(fd)); });
  finish(base(cid, r.date), `${r.service} är bokad ${r.date} ${r.time}`);
}
export async function prepayAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'payments' }));
  let a = 0;
  await attempt(base(cid, day(fd)), async () => { a = await svc.prepay(actor, id, form(fd)); });
  finish(base(cid, day(fd)), `Förskottet ${kr(a)} kr är bokfört som förutbetald intäkt`);
}
export async function doneAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(base(cid, day(fd)), async () => { await svc.done(actor, id); });
  finish(base(cid, day(fd)), 'Tjänsten är utförd och intäktsförd');
}
export async function closeAction(cid: number, id: number, kind: 'cancelled' | 'no_show', fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  let r = { kept: 0, refunded: 0 };
  await attempt(base(cid, day(fd)), async () => { r = await svc.close(actor, id, kind); });
  finish(base(cid, day(fd)), `${kind === 'no_show' ? 'Uteblivet besök' : 'Avbokad'}${r.kept || r.refunded ? `: ${kr(r.kept)} kr behålls, ${kr(r.refunded)} kr betalas tillbaka` : ''}`);
}
