'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/netting';

const base = (cid: number) => `/c/${cid}/kvittning`;
export async function offsetAction(cid: number, fd: FormData) {
  // Kvittningen markerar både kund- och leverantörsfakturor som betalda: samma behörigheter som för betalningarna
  await requireCompany(cid, { perm: 'invoicing' });
  const actor = userActor(await requireCompany(cid, { perm: 'payments' }));
  let a = 0;
  await attempt(base(cid), async () => { a = await svc.offset(actor, Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]))); });
  done(base(cid), `Kvittningen är bokförd: ${kr(a)} kr`);
}
