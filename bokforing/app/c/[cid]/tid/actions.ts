'use server';
import { sql } from '@/lib/db';
import { attempt, done, result, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { createTimeEntry, deleteTimeEntry } from '@/lib/services/time';

const back = (cid: number, week: string) => `/c/${cid}/tid?week=${week}`;

export async function addTime(cid: number, week: string, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { employee: true }));
  await attempt(back(cid, week), () => createTimeEntry(actor, {
    activity_id: str(fd, 'activity_id'), date: str(fd, 'date'), hours: str(fd, 'hours'), description: str(fd, 'description'),
    billable: fd.get('billable') === 'on', start_time: str(fd, 'start_time'), end_time: str(fd, 'end_time'), kind: str(fd, 'kind'),
  }));
  done(back(cid, week), 'Tiden är sparad');
}

export async function removeTime(cid: number, week: string, id: number) {
  const ctx = await requireCompany(cid, { employee: true });
  const actor = userActor(ctx);
  await attempt(back(cid, week), async () => {
    if (ctx.role === 'employee') {
      const [e] = await sql<{ user_id: number }[]>`SELECT user_id FROM time_entries WHERE id = ${id} AND company_id = ${ctx.company.id}`;
      if (!e || e.user_id !== ctx.user.id) throw new Error('Du kan bara ta bort din egen tid');
    }
    await deleteTimeEntry(actor, id);
  });
  done(back(cid, week), 'Tidraden är borttagen');
}

export async function removeTimeNow(cid: number, id: number) {
  const ctx = await requireCompany(cid, { employee: true });
  const actor = userActor(ctx);
  return result(async () => {
    if (ctx.role === 'employee') {
      const [e] = await sql<{ user_id: number }[]>`SELECT user_id FROM time_entries WHERE id = ${id} AND company_id = ${ctx.company.id}`;
      if (!e || e.user_id !== ctx.user.id) throw new Error('Du kan bara ta bort din egen tid');
    }
    await deleteTimeEntry(actor, id);
  });
}
