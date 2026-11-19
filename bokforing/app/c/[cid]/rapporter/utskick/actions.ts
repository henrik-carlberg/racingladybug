'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { createSchedule, deleteSchedule, sendSchedule } from '@/lib/services/report-schedules';
import { mailConfigured } from '@/lib/server/mail';

const base = (cid: number) => `/c/${cid}/rapporter/utskick`;

export async function create(cid: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(base(cid), () => createSchedule(a, { recipients: str(fd, 'recipients'), day: Number(str(fd, 'day')), compare: str(fd, 'compare') }));
  done(base(cid), 'Utskicket är sparat');
}
export async function remove(cid: number, id: number) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await deleteSchedule(a, id);
  done(base(cid), 'Utskicket är borttaget');
}
export async function sendNow(cid: number, id: number) {
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  let n = 0;
  await attempt(base(cid), async () => {
    if (!mailConfigured()) throw new Error('E-post är inte uppsatt på servern – ladda ner rapporten och skicka den själv');
    n = (await sendSchedule(company.id, id)).sent;
  });
  done(base(cid), `Rapporten skickades till ${n} mottagare`);
}
