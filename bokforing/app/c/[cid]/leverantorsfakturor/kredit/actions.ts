'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/supplier-credit';

const base = (cid: number) => `/c/${cid}/leverantorsfakturor/kredit`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
export async function register(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'purchasing' }));
  let r = { applied: 0, left: 0 };
  await attempt(base(cid), async () => { r = await svc.register(actor, form(fd)); });
  done(base(cid), `Kreditfakturan är bokförd${r.applied ? `, ${kr(r.applied)} kr är kvittat mot fakturan` : ''}${r.left ? `, ${kr(r.left)} kr finns kvar att kvitta eller få tillbaka` : ''}`);
}
// Kvittning och återbetalning markerar leverantörsfakturor som betalda: samma behörighet som för betalningar
export async function apply(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'payments' }));
  let a = 0;
  await attempt(base(cid), async () => { a = await svc.apply(actor, id, form(fd)); });
  done(base(cid), `${kr(a)} kr är kvittat`);
}
export async function refund(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'payments' }));
  let a = 0;
  await attempt(base(cid), async () => { a = await svc.refund(actor, id, form(fd)); });
  done(base(cid), `Återbetalningen ${kr(a)} kr är bokförd`);
}
