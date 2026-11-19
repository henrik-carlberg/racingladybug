'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { adjustFlex, payoutFlex, setFlex } from '@/lib/services/payroll2';

const back = (cid: number, e?: number) => `/c/${cid}/lon/flex${e ? `?e=${e}` : ''}`;
export async function enable(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'payroll' }));
  const e = Number(str(fd, 'employee_id'));
  await attempt(back(cid), () => setFlex(actor, e, str(fd, 'start') || null));
  done(back(cid, e), 'Flextiden räknas från startdatumet');
}
export async function adjust(cid: number, e: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'payroll' }));
  await attempt(back(cid, e), () => adjustFlex(actor, e, { kind: str(fd, 'kind'), hours: str(fd, 'hours'), note: str(fd, 'note'), date: str(fd, 'date') }));
  done(back(cid, e), 'Tidbanken är uppdaterad');
}
export async function payout(cid: number, e: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'payroll' }));
  let amt = 0;
  await attempt(back(cid, e), async () => { amt = await payoutFlex(actor, e, { hours: str(fd, 'hours'), run_id: str(fd, 'run_id') }); });
  done(back(cid, e), `Utbetalningen (${(amt / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2 })} kr) är lagd på lönen`);
}
