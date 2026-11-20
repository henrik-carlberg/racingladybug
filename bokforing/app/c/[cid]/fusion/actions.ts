'use server';
import { attempt, done, str } from '@/lib/server/action';
import { allowedCompanies, companyAccess, requireCompany } from '@/lib/server/auth';
import { ForbiddenError } from '@/lib/errors';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/merger';

const base = (cid: number) => `/c/${cid}/fusion`;
/** Inloggningen måste uppfylla även dotterbolagets åtkomstregler, eftersom fusionen bokför i båda bolagen */
async function guard(subId: number) {
  if (!(await allowedCompanies([{ id: subId }])).length || (await companyAccess(subId)).state === 'locked') throw new ForbiddenError('Din inloggning har inte åtkomst till dotterbolaget');
}
export async function planMerger(cid: number, sub: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { owner: true }));
  await attempt(base(cid), async () => { await guard(sub); await svc.plan(actor, sub, { plan_date: str(fd, 'plan_date') }); });
  done(base(cid), 'Fusionsplanen är registrerad');
}
export async function completeMerger(cid: number, sub: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { owner: true }));
  let t = { difference: 0, net: 0 };
  await attempt(base(cid), async () => { await guard(sub); t = await svc.complete(actor, sub, { registered_on: str(fd, 'registered_on'), treatment: str(fd, 'treatment') }); });
  done(base(cid), `Fusionen är bokförd: nettotillgångar ${kr(t.net)} kr, fusionsdifferens ${kr(t.difference)} kr`);
}
