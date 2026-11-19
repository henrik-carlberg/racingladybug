'use server';
import { amount, attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/intercompany';

const back = (cid: number) => `/c/${cid}/koncerninternt`;
export async function addCharge(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { owner: true }));
  await attempt(back(cid), () => svc.addCharge(actor, { target_company_id: str(fd, 'target_company_id'), kind: str(fd, 'kind'), start_period: str(fd, 'start_period'),
    amount: str(fd, 'amount') ? amount(fd, 'amount', 'Avgift') : undefined, principal: str(fd, 'principal') ? amount(fd, 'principal', 'Lån') : undefined, rate_pct: str(fd, 'rate_pct') }));
  done(back(cid), 'Koncernavgiften är upplagd');
}
export async function run(cid: number) {
  const actor = userActor(await requireCompany(cid, { owner: true }));
  let n = 0;
  await attempt(back(cid), async () => { n = await svc.runCharges(actor.companyId); });
  done(back(cid), `${n} koncernfakturor är skapade och speglade hos mottagarna`);
}
export async function stop(cid: number, id: number) {
  const actor = userActor(await requireCompany(cid, { owner: true }));
  await attempt(back(cid), () => svc.stopCharge(actor, id));
  done(back(cid), 'Avgiften är avslutad');
}
export async function retry(cid: number, invoiceId: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(back(cid), async () => { await svc.retryMirror(actor, invoiceId); });
  done(back(cid), 'Fakturan är speglad');
}
