'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { createTimeEntry, deleteTimeEntry } from '@/lib/services/time';

const back = (cid: number, week: string) => `/c/${cid}/tid?week=${week}`;

export async function addTime(cid: number, week: string, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  await attempt(back(cid, week), () => createTimeEntry(actor, {
    activity_id: str(fd, 'activity_id'), date: str(fd, 'date'), hours: str(fd, 'hours'), description: str(fd, 'description'),
    billable: fd.get('billable') === 'on',
  }));
  done(back(cid, week), 'Tiden är sparad');
}

export async function removeTime(cid: number, week: string, id: number) {
  const actor = userActor(await requireCompany(cid));
  await attempt(back(cid, week), () => deleteTimeEntry(actor, id));
  done(back(cid, week), 'Tidraden är borttagen');
}
