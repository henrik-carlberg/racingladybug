'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/employee-loans';

const base = (cid: number) => `/c/${cid}/lon/medarbetarlan`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
const actorFor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'payroll' }));
export async function addLoan(cid: number, fd: FormData) {
  const actor = await actorFor(cid);
  let r = { name: '', benefitRate: 0, agreed: 0 };
  await attempt(base(cid), async () => { r = await svc.addLoan(actor, form(fd)); });
  done(base(cid), `Lånet till ${r.name} är bokfört. ${r.agreed < r.benefitRate ? `Räntan ${r.agreed} % är lägre än förmånsräntan ${r.benefitRate} %: skillnaden blir en skattepliktig ränteförmån.` : 'Ingen ränteförmån.'}`);
}
export async function applyToRun(cid: number, id: number, fd: FormData) {
  const actor = await actorFor(cid);
  let r = { amortization: 0, interest: 0, benefit: 0 };
  await attempt(base(cid), async () => { r = await svc.applyToRun(actor, id, form(fd)); });
  done(base(cid), `På lönespecen: amortering ${kr(r.amortization)} kr, ränta ${kr(r.interest)} kr, ränteförmån ${kr(r.benefit)} kr`);
}
