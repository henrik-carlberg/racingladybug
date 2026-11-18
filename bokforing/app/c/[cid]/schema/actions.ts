'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/staff';

const base = (cid: number, week: string) => `/c/${cid}/schema?vecka=${week}`;

export async function addShift(cid: number, week: string, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  await attempt(base(cid, week), () => svc.createShift(actor, {
    employee_id: Number(str(fd, 'employee_id')), date: str(fd, 'date'), start: str(fd, 'start'), end: str(fd, 'end'),
    site_id: Number(str(fd, 'site_id')) || null, role: str(fd, 'role'), note: str(fd, 'note'),
  }));
  done(base(cid, week), 'Passet är tillagt');
}

export async function removeShift(cid: number, week: string, id: number) {
  const actor = userActor(await requireCompany(cid));
  await attempt(base(cid, week), () => svc.deleteShift(actor, id));
  done(base(cid, week), 'Passet är borttaget');
}

export async function copyWeek(cid: number, week: string) {
  const actor = userActor(await requireCompany(cid));
  let n = 0;
  await attempt(base(cid, week), async () => { n = await svc.copyWeek(actor, week); });
  done(base(cid, week), `${n} pass kopierade från förra veckan`);
}
