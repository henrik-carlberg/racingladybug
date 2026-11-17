'use server';
import { amount, attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { isModuleEnabled } from '@/lib/modules/enabled';
import { userActor } from '@/lib/services/actor';
import * as svc from './service';

async function ctx(cid: number) {
  const c = await requireCompany(cid);
  if (!(await isModuleEnabled(c.company.id, 'projekt'))) throw new Error('Projektmodulen är inte aktiverad');
  return userActor(c);
}
const base = (cid: number) => `/c/${cid}/m/projekt`;
const one = (cid: number, pid: number, hash = '') => `${base(cid)}/p/${pid}${hash}`;
const detailFields = (fd: FormData) => ({
  manager_user_id: str(fd, 'manager_user_id'), status: str(fd, 'status'), start_date: str(fd, 'start_date'), end_date: str(fd, 'end_date'),
  budget_hours: str(fd, 'budget_hours'), budget_revenue: amount(fd, 'budget_revenue', 'Intäktsbudget') ?? 0, budget_cost: amount(fd, 'budget_cost', 'Kostnadsbudget') ?? 0,
  internal_rate: amount(fd, 'internal_rate', 'Internt timpris') ?? 0, description: str(fd, 'description'),
});

export async function create(cid: number, fd: FormData) {
  const actor = await ctx(cid);
  let id = 0;
  await attempt(base(cid), async () => {
    id = (await svc.createProject(actor, {
      ...detailFields(fd), customer_id: str(fd, 'customer_id'), name: str(fd, 'name'), billing: str(fd, 'billing'),
      hourly_rate: amount(fd, 'hourly_rate', 'Timpris') ?? 0, vat_rate: 25, activities: str(fd, 'activities'),
    })).id;
  });
  done(one(cid, id), 'Projektet är skapat');
}

export async function saveDetails(cid: number, pid: number, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(one(cid, pid), () => svc.saveDetails(actor, pid, detailFields(fd)));
  done(one(cid, pid), 'Projektplanen är sparad');
}

export async function saveMilestone(cid: number, pid: number, id: number | null, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(one(cid, pid, '#delmoment'), () => svc.saveMilestone(actor, pid, id, { name: str(fd, 'name'), due_date: str(fd, 'due_date'), amount: amount(fd, 'amount', 'Belopp') ?? 0 }));
  done(one(cid, pid, '#delmoment'), id ? 'Delmomentet är sparat' : 'Delmomentet är tillagt');
}

export async function milestoneDone(cid: number, pid: number, id: number, isDone: boolean) {
  const actor = await ctx(cid);
  await attempt(one(cid, pid, '#delmoment'), () => svc.setMilestoneDone(actor, pid, id, isDone));
  done(one(cid, pid, '#delmoment'), isDone ? 'Delmomentet är klart' : 'Delmomentet är återöppnat');
}

export async function invoiceMilestone(cid: number, pid: number, id: number) {
  const actor = await ctx(cid);
  let iid = 0;
  await attempt(one(cid, pid, '#delmoment'), async () => { iid = (await svc.invoiceMilestone(actor, pid, id)).id; });
  done(`/c/${cid}/fakturor/${iid}`, 'Fakturautkastet för delmomentet är skapat');
}

export async function saveTask(cid: number, pid: number, id: number | null, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(one(cid, pid, '#uppgifter'), () => svc.saveTask(actor, pid, id, {
    title: str(fd, 'title'), description: str(fd, 'description'), assignee_user_id: str(fd, 'assignee_user_id'), milestone_id: str(fd, 'milestone_id'),
    estimate: str(fd, 'estimate'), due_date: str(fd, 'due_date'),
  }));
  done(one(cid, pid, '#uppgifter'), id ? 'Uppgiften är sparad' : 'Uppgiften är tillagd');
}

export async function taskStatus(cid: number, pid: number, id: number, status: 'todo' | 'doing' | 'done', back?: string) {
  const actor = await ctx(cid);
  const to = back ?? one(cid, pid, '#uppgifter');
  await attempt(to, () => svc.setTaskStatus(actor, pid, id, status));
  done(to, 'Uppgiften är flyttad');
}

export async function deleteTask(cid: number, pid: number, id: number) {
  const actor = await ctx(cid);
  await attempt(one(cid, pid, '#uppgifter'), () => svc.deleteTask(actor, pid, id));
  done(one(cid, pid, '#uppgifter'), 'Uppgiften är borttagen');
}

export async function logTime(cid: number, pid: number, taskId: number, back: string | null, fd: FormData) {
  const actor = await ctx(cid);
  const to = back ?? one(cid, pid, '#uppgifter');
  await attempt(to, () => svc.logTime(actor, pid, taskId, { hours: str(fd, 'hours'), date: str(fd, 'date'), description: str(fd, 'description') }));
  done(to, 'Tiden är rapporterad');
}

export async function linkCost(cid: number, pid: number, voucherId: number, account: number) {
  const actor = await ctx(cid);
  await attempt(one(cid, pid, '#kostnader'), () => svc.linkCost(actor, pid, voucherId, account));
  done(one(cid, pid, '#kostnader'), 'Kostnaden är kopplad till projektet');
}

export async function addCost(cid: number, pid: number, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(one(cid, pid, '#kostnader'), () => svc.addCost(actor, pid, { date: str(fd, 'date'), amount: amount(fd, 'amount', 'Belopp'), description: str(fd, 'description') }));
  done(one(cid, pid, '#kostnader'), 'Kostnaden är tillagd');
}

export async function removeCost(cid: number, pid: number, costId: number) {
  const actor = await ctx(cid);
  await attempt(one(cid, pid, '#kostnader'), () => svc.removeCost(actor, pid, costId));
  done(one(cid, pid, '#kostnader'), 'Kostnaden är borttagen');
}
