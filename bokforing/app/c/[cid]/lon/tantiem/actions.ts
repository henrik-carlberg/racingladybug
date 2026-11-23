'use server';
import { redirect } from 'next/navigation';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/profit-share';

const base = (cid: number, fy?: number) => `/c/${cid}/lon/tantiem${fy ? `?fy=${fy}` : ''}`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function showAction(cid: number, fd: FormData) {
  await requireCompany(cid, { perm: 'payroll' });
  redirect(base(cid, Number(fd.get('fy')) || undefined));
}
export async function addAction(cid: number, fy: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'payroll' }));
  await attempt(base(cid, fy), () => svc.addPlan(actor, form(fd)));
  done(base(cid, fy), 'Tantiemavtalet är upplagt');
}
export async function accrueAction(cid: number, fy: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let r = { result: 0, total: 0 };
  await attempt(base(cid, fy), async () => { r = await svc.accrue(actor, fy); });
  done(base(cid, fy), `Upplupen tantiem med sociala avgifter är bokförd: ändring ${kr(r.total)} kr`);
}
export async function payoutAction(cid: number, fy: number, accrualId: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'payroll' }));
  let a = 0;
  await attempt(base(cid, fy), async () => { a = await svc.addToRun(actor, accrualId, form(fd)); });
  done(base(cid, fy), `Tantiemen ${kr(a)} kr är lagd på lönekörningen – den upplupna lönen löses upp när lönen bokförs`);
}
