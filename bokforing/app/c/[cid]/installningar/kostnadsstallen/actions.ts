'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/dimensions';

const base = (cid: number) => `/c/${cid}/installningar/kostnadsstallen`;

export async function create(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  await attempt(base(cid), () => svc.createCostCenter(actor, str(fd, 'code'), str(fd, 'name')));
  done(base(cid), 'Kostnadsstället är skapat');
}

export async function update(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  await attempt(base(cid), () => svc.updateCostCenter(actor, id, { name: str(fd, 'name'), active: fd.get('active') === 'on' }));
  done(base(cid), 'Kostnadsstället är sparat');
}
