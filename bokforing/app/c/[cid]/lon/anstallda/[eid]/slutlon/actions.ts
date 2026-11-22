'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/final-pay';

export async function applyFinalPay(cid: number, eid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'payroll' }));
  const back = `/c/${cid}/lon/anstallda/${eid}/slutlon`;
  let r = { salary: 0, vacation: 0, advance: 0, days: 0 };
  await attempt(back, async () => { r = await svc.apply(actor, eid, Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]))); });
  done(back, `Slutlönen ligger på lönespecen: lön ${kr(r.salary)} kr, semesterersättning ${kr(r.vacation)} kr för ${r.days} dagar${r.advance ? `, avdrag förskottssemester ${kr(r.advance)} kr` : ''}. Anställningen är avslutad.`);
}
