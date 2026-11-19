'use server';
import { amount, attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { deleteContract, saveContract } from '@/lib/services/contracts';

const back = (cid: number) => `/c/${cid}/leverantorsavtal`;
export async function add(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'purchasing' }));
  await attempt(back(cid), () => saveContract(actor, { name: str(fd, 'name'), supplier_id: str(fd, 'supplier_id'), start_date: str(fd, 'start_date'), end_date: str(fd, 'end_date'),
    notice_months: str(fd, 'notice_months'), auto_renew: fd.get('auto_renew') === 'on', renew_months: str(fd, 'renew_months'), monthly_cost: amount(fd, 'monthly_cost', 'Kostnad') ?? undefined, notes: str(fd, 'notes') }));
  done(back(cid), 'Avtalet är sparat');
}
export async function remove(cid: number, id: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'purchasing' }));
  await attempt(back(cid), () => deleteContract(actor, id));
  done(back(cid), 'Avtalet är borttaget');
}
