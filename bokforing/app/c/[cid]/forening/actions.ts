'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as a from '@/lib/services/association';

const back = (cid: number, y?: unknown) => `/c/${cid}/forening${y ? `?ar=${String(y).replace(/\D/g, '').slice(0, 4)}` : ''}`;
async function run<T>(b: string, fn: () => Promise<T>): Promise<T> { let r!: T; await attempt(b, async () => { r = await fn(); }); return r; }
const obj = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function toggle(cid: number, on: boolean) {
  const actor = userActor(await requireCompany(cid, { owner: true }));
  await attempt(back(cid), () => a.setAssociation(actor, on));
  done(back(cid), on ? 'Föreningsläget är på – eget kapital bokförs på 2068/2069' : 'Föreningsläget är av');
}
export async function addMember(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  const m = await run(back(cid), () => a.addMember(actor, obj(fd)));
  done(back(cid), `Medlem nr ${m.member_no} är registrerad`);
}
export async function leave(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(back(cid), () => a.leaveMember(actor, id, obj(fd)));
  done(back(cid), 'Utträdet är registrerat');
}
export async function rate(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(back(cid, fd.get('year')), () => a.setFeeRate(actor, obj(fd)));
  done(back(cid, fd.get('year')), 'Avgiften är sparad');
}
export async function invoiceFees(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  const n = await run(back(cid, fd.get('year')), () => a.invoiceFees(actor, obj(fd)));
  done(back(cid, fd.get('year')), `${n} avier är skapade och bokförda`);
}
export async function gift(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid), () => a.registerGift(actor, obj(fd)));
  done(back(cid, String(fd.get('date') ?? '').slice(0, 4)), fd.get('kind') === 'grant' ? 'Bidraget är bokfört' : 'Gåvan är bokförd');
}
export async function meeting(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid, fd.get('year')), () => a.saveMeeting(actor, obj(fd)));
  done(back(cid, fd.get('year')), 'Årsmötet är sparat');
}
export async function notice(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const r = await run(back(cid, fd.get('year')), () => a.sendNotice(actor, obj(fd)));
  done(back(cid, fd.get('year')), `Kallelsen är skickad till ${r.sent} av ${r.members} medlemmar med e-post${r.late ? ' – obs! senare än stadgarnas två veckor' : ''}`);
}
export async function report(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const d = await run(back(cid, fd.get('year')), () => a.createReport(actor, obj(fd)));
  done(`/c/${cid}/dokument/${d.id}`, 'Verksamhetsberättelsen är skapad – skicka den för underskrift');
}
export async function auditReport(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const d = await run(back(cid, fd.get('year')), () => a.createAuditReport(actor, obj(fd)));
  done(`/c/${cid}/dokument/${d.id}`, 'Revisionsberättelsen är skapad – skicka den för underskrift');
}
