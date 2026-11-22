'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/dim-budget';

export async function save(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const input = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
  const base = `/c/${cid}/rapporter/budget/dimensioner?ar=${input.year}&dim=${input.dim}`;
  await attempt(base, () => svc.save(actor, input));
  done(base, 'Budgeten är sparad');
}
