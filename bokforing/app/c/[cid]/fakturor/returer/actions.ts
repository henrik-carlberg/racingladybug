'use server';
import { redirect } from 'next/navigation';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/returns';

const base = (cid: number) => `/c/${cid}/fakturor/returer`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const stockText = (r: { restocked: number; scrapped: number }) => [r.restocked ? `${r.restocked} tillbaka i lager` : '', r.scrapped ? `${r.scrapped} kasserade` : ''].filter(Boolean).join(', ');

export async function openAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  const invoice = String(fd.get('invoice_id') ?? '');
  await attempt(`${base(cid)}?invoice=${encodeURIComponent(invoice)}`, async () => { await svc.openCase(actor, form(fd)); });
  done(base(cid), 'Returärendet är registrerat');
}
export async function creditAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  let r = { invoiceId: 0, restocked: 0, scrapped: 0 };
  await attempt(base(cid), async () => { r = await svc.credit(actor, id, form(fd)); });
  const s = stockText(r);
  redirect(`/c/${cid}/fakturor/${r.invoiceId}?ok=${encodeURIComponent(`Kreditfakturautkast för returen är skapat – granska och bokför${s ? `. Varor: ${s}` : ''}`)}`);
}
export async function replaceAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  let r = { delivered: 0, restocked: 0, scrapped: 0 };
  await attempt(base(cid), async () => { r = await svc.replace(actor, id, form(fd)); });
  const s = stockText(r);
  done(base(cid), `Ersättningsvara skickad utan ny faktura${r.delivered ? ` – ${r.delivered} levererade ur lagret` : ''}${s ? `, returnerat: ${s}` : ''}`);
}
export async function rejectAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(base(cid), async () => { await svc.reject(actor, id, form(fd)); });
  done(base(cid), 'Reklamationen är avslagen');
}
