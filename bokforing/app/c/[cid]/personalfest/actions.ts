'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/staff-events';

export async function register(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const base = `/c/${cid}/personalfest`;
  let r = { vatDed: 0, deductible: 0, nonDeductible: 0, warnings: [] as string[] };
  await attempt(base, async () => { r = await svc.register(actor, Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]))); });
  done(base, `Bokfört: moms att dra av ${kr(r.vatDed)} kr, avdragsgillt ${kr(r.deductible)} kr, ej avdragsgillt ${kr(r.nonDeductible)} kr.${r.warnings.length ? ' ⚠️ ' + r.warnings.join(' ') : ''}`);
}
