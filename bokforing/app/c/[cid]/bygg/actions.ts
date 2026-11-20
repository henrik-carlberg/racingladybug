'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as s from '@/lib/services/construction';

const back = (cid: number) => `/c/${cid}/bygg`;
async function run<T>(b: string, fn: () => Promise<T>): Promise<T> { let r!: T; await attempt(b, async () => { r = await fn(); }); return r; }
const obj = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function addAta(cid: number, contractId: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  const r = await run(back(cid), () => s.addChangeOrder(a, contractId, obj(fd)));
  done(back(cid), `ÄTA ${r.no} är registrerad och väntar på beställarens beslut`);
}
export async function decideAta(cid: number, id: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(back(cid), () => s.decideChangeOrder(a, id, obj(fd)));
  done(back(cid), fd.get('decision') === 'approve' ? 'ÄTA:n är godkänd – kontraktsvärdet är uppdaterat' : 'ÄTA:n är avslagen');
}
export async function retainCustomer(cid: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const r = await run(back(cid), () => s.retainCustomer(a, obj(fd)));
  done(back(cid), `${(r.amount / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2 })} kr är innehållet och bokfört på 1682`);
}
export async function retainSupplier(cid: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const r = await run(back(cid), () => s.retainSupplier(a, obj(fd)));
  done(back(cid), `${(r.amount / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2 })} kr är innehållet och bokfört på 2446`);
}
export async function release(cid: number, id: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid), () => s.release(a, id, obj(fd)));
  done(back(cid), 'Det innehållna beloppet är frisläppt och bokfört');
}
