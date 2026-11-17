'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { isModuleEnabled } from '@/lib/modules/enabled';
import { userActor } from '@/lib/services/actor';
import { createActivity, createContact, updateActivity } from './service';

async function ctx(cid: number) {
  const c = await requireCompany(cid);
  if (!(await isModuleEnabled(c.company.id, 'crm'))) throw new Error('CRM-modulen är inte aktiverad');
  return userActor(c);
}

export async function addActivity(cid: number, customerId: number, fd: FormData) {
  const actor = await ctx(cid);
  const back = `/c/${cid}/m/crm/kund/${customerId}`;
  await attempt(back, async () => {
    await createActivity(actor, { customer_id: customerId, kind: str(fd, 'kind'), subject: str(fd, 'subject'), body: str(fd, 'body'), due_date: str(fd, 'due_date') });
  });
  done(back);
}

export async function completeTask(cid: number, back: string, activityId: number) {
  const actor = await ctx(cid);
  await attempt(back, async () => { await updateActivity(actor, activityId, { done: true }); });
  done(back);
}

export async function addContact(cid: number, customerId: number, fd: FormData) {
  const actor = await ctx(cid);
  const back = `/c/${cid}/m/crm/kund/${customerId}`;
  await attempt(back, async () => {
    await createContact(actor, { customer_id: customerId, name: str(fd, 'name'), email: str(fd, 'email'), phone: str(fd, 'phone'), title: str(fd, 'title') });
  });
  done(back, 'Kontakten är sparad');
}
