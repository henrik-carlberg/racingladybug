'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/debt-settlement';

export async function settle(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const base = `/c/${cid}/ackord`;
  const input: Record<string, unknown> = Object.fromEntries([...fd.entries()].filter(([k]) => k !== 'inv').map(([k, v]) => [k, String(v)]));
  input.invoices = fd.getAll('inv').map(String).join(',');
  let r = { total: 0, toPay: 0 };
  await attempt(base, async () => { r = await svc.settle(actor, input); });
  done(base, `Ackordet är bokfört: skulderna är nedsatta med ${kr(r.total)} kr (ackordsvinst, ej skattepliktig), ${kr(r.toPay)} kr ska betalas enligt ackordet`);
}
