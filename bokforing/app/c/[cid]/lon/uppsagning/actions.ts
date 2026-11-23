'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/terminations';

const base = (cid: number) => `/c/${cid}/lon/uppsagning`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function terminateAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'payroll' }));
  let r = { id: 0, months: 0, lastDay: '' };
  await attempt(base(cid), async () => { r = await svc.terminate(actor, form(fd)); });
  done(base(cid), `Uppsägningen är registrerad: ${r.months} månaders uppsägningstid, sista anställningsdag ${r.lastDay}`);
}
export async function accrueAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'payroll' }));
  let r = { salary: 0, fee: 0, total: 0 };
  await attempt(base(cid), async () => { r = await svc.accrue(actor, id, form(fd)); });
  done(base(cid), `Skulden ${kr(r.total)} kr är bokförd (lön ${kr(r.salary)} kr, avgifter ${kr(r.fee)} kr)`);
}
export async function endAction(cid: number, id: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'payroll' }));
  let d = '';
  await attempt(base(cid), async () => { d = await svc.end(actor, id); });
  done(base(cid), `Anställningen är avslutad ${d}`);
}
