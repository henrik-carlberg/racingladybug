'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/withholding';

const base = (cid: number) => `/c/${cid}/kupongskatt`;
export async function payDividend(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let r = { pct: 0, withheld: 0, net: 0, rule: '' };
  await attempt(base(cid), async () => { r = await svc.pay(actor, Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]))); });
  done(base(cid), `Utdelningen är bokförd: kupongskatt ${r.pct} % (${kr(r.withheld)} kr), utbetalt ${kr(r.net)} kr. ${r.rule}`);
}
export async function payWithholding(cid: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let a = 0;
  await attempt(base(cid), async () => { a = await svc.payTax(actor); });
  done(base(cid), `Kupongskatt ${kr(a)} kr är bokförd som betald till Skatteverket`);
}
