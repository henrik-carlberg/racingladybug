'use server';
import { amount, attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { isModuleEnabled } from '@/lib/modules/enabled';
import { userActor } from '@/lib/services/actor';
import * as svc from './service';

async function ctx(cid: number) {
  const c = await requireCompany(cid);
  if (!(await isModuleEnabled(c.company.id, 'marknad'))) throw new Error('Marknadsmodulen är inte aktiverad');
  return userActor(c);
}
const base = (cid: number) => `/c/${cid}/m/marknad`;

export async function saveCampaign(cid: number, id: number | null, fd: FormData) {
  const actor = await ctx(cid);
  let cId = id ?? 0;
  await attempt(id ? `${base(cid)}/kampanjer/${id}` : `${base(cid)}/kampanjer`, async () => {
    cId = (await svc.saveCampaign(actor, id, {
      name: str(fd, 'name'), channel: str(fd, 'channel'), status: str(fd, 'status'), start_date: str(fd, 'start_date'), end_date: str(fd, 'end_date'),
      budget: amount(fd, 'budget', 'Budget') ?? 0, goal: str(fd, 'goal'), code: str(fd, 'code'),
    })).id;
  });
  done(`${base(cid)}/kampanjer/${cId}`, id ? 'Kampanjen är sparad' : 'Kampanjen är skapad');
}

export async function linkCost(cid: number, id: number, voucherId: number, account: number) {
  const actor = await ctx(cid);
  await attempt(`${base(cid)}/kampanjer/${id}`, () => svc.linkCost(actor, id, { voucher_id: voucherId, account }));
  done(`${base(cid)}/kampanjer/${id}`, 'Kostnaden är kopplad till kampanjen');
}

export async function addCost(cid: number, id: number, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(`${base(cid)}/kampanjer/${id}`, () => svc.addCost(actor, id, { date: str(fd, 'date'), amount: amount(fd, 'amount', 'Belopp'), description: str(fd, 'description') }));
  done(`${base(cid)}/kampanjer/${id}`, 'Kostnaden är tillagd');
}

export async function removeCost(cid: number, id: number, costId: number) {
  const actor = await ctx(cid);
  await attempt(`${base(cid)}/kampanjer/${id}`, () => svc.removeCost(actor, id, costId));
  done(`${base(cid)}/kampanjer/${id}`, 'Kostnaden är borttagen från kampanjen');
}

export async function createLead(cid: number, fd: FormData) {
  const actor = await ctx(cid);
  let id = 0;
  await attempt(`${base(cid)}/leads`, async () => {
    id = (await svc.createLead(actor, {
      name: str(fd, 'name'), company_name: str(fd, 'company_name'), email: str(fd, 'email'), phone: str(fd, 'phone'), source: str(fd, 'source'),
      campaign_id: str(fd, 'campaign_id'), value: amount(fd, 'value', 'Värde'), consent: fd.get('consent') === 'on', notes: str(fd, 'notes'),
    })).id;
  });
  done(`${base(cid)}/leads/${id}`, 'Leadet är registrerat');
}

export async function updateLead(cid: number, id: number, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(`${base(cid)}/leads/${id}`, () => svc.updateLead(actor, id, {
    status: str(fd, 'status'), notes: str(fd, 'notes'), value: amount(fd, 'value', 'Värde'), campaign_id: str(fd, 'campaign_id'), consent: fd.get('consent') === 'on',
  }));
  done(`${base(cid)}/leads/${id}`, 'Leadet är sparat');
}

export async function convertLead(cid: number, id: number) {
  const actor = await ctx(cid);
  await attempt(`${base(cid)}/leads/${id}`, () => svc.convertLead(actor, id));
  done(`${base(cid)}/leads/${id}`, 'Leadet är nu kund och finns i kundregistret');
}

export async function deleteLead(cid: number, id: number) {
  const actor = await ctx(cid);
  await attempt(`${base(cid)}/leads/${id}`, () => svc.deleteLead(actor, id));
  done(`${base(cid)}/leads`, 'Leadet är raderat');
}

export async function purge(cid: number) {
  const actor = await ctx(cid);
  let n = 0;
  await attempt(`${base(cid)}/leads`, async () => { n = await svc.purgeLeads(actor); });
  done(`${base(cid)}/leads`, `${n} leads är gallrade`);
}

export async function saveBudget(cid: number, year: number, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(`${base(cid)}?ar=${year}`, () => svc.saveBudget(actor, year, [...Array(12)].map((_, i) => amount(fd, `m${i + 1}`, 'Budget'))));
  done(`${base(cid)}?ar=${year}`, 'Marknadsbudgeten är sparad');
}
