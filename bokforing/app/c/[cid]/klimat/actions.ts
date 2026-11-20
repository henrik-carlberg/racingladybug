'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { addActivity, removeActivity, setFactor } from '@/lib/services/climate';

const back = (cid: number, y?: string) => `/c/${cid}/klimat${y ? `?ar=${y}` : ''}`;
export async function add(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid), () => addActivity(actor, { kind: str(fd, 'kind'), quantity: str(fd, 'quantity'), date: str(fd, 'date'), note: str(fd, 'note') }));
  done(back(cid, str(fd, 'date').slice(0, 4)), 'Mängden är sparad och ersätter schablonen för kategorin');
}
export async function remove(cid: number, id: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid), () => removeActivity(actor, id));
  done(back(cid), 'Mängden är borttagen');
}
export async function factor(cid: number, key: string, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid), () => setFactor(actor, key, str(fd, 'factor')));
  done(back(cid), 'Faktorn är sparad');
}
