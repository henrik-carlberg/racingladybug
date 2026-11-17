'use server';
import { amount, attempt, done, str } from '@/lib/server/action';
import { requestOrigin } from '@/lib/server/origin';
import * as pl from './pipeline';
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

// ---------- Säljpipeline ----------

const deal = (cid: number, id: number) => `/c/${cid}/m/crm/affar/${id}`;
const dealFields = (fd: FormData) => ({
  title: str(fd, 'title'), customer_id: str(fd, 'customer_id'), prospect_name: str(fd, 'prospect_name'), contact_name: str(fd, 'contact_name'),
  contact_email: str(fd, 'contact_email'), value: amount(fd, 'value', 'Värde') ?? 0, probability: str(fd, 'probability'), expected_close: str(fd, 'expected_close'),
  owner_user_id: str(fd, 'owner_user_id'), source: str(fd, 'source'), next_step: str(fd, 'next_step'), stage_id: str(fd, 'stage_id') || undefined,
});

export async function createDeal(cid: number, fd: FormData) {
  const actor = await ctx(cid);
  let id = 0;
  await attempt(`/c/${cid}/m/crm/pipeline`, async () => { id = (await pl.createDeal(actor, dealFields(fd))).id; });
  done(deal(cid, id), 'Affären är skapad');
}

export async function updateDeal(cid: number, id: number, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(deal(cid, id), () => pl.updateDeal(actor, id, dealFields(fd)));
  done(deal(cid, id), 'Affären är sparad');
}

export async function moveDeal(cid: number, id: number, back: string | null, fd: FormData) {
  const actor = await ctx(cid);
  const to = back ?? deal(cid, id);
  await attempt(to, () => pl.moveDeal(actor, id, { stage_id: str(fd, 'stage_id'), lost_reason: str(fd, 'lost_reason') }));
  done(to, 'Affären är flyttad');
}

export async function saveQuote(cid: number, id: number, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(deal(cid, id), async () => {
    const lines = [];
    for (let i = 0; i < 10; i++) {
      if (!str(fd, `d_${i}`)) continue;
      lines.push({ description: str(fd, `d_${i}`), quantity: str(fd, `q_${i}`) || '1', unit: str(fd, `u_${i}`), unit_price: amount(fd, `p_${i}`, `Rad ${i + 1}: pris`) ?? 0, vat_rate: str(fd, `v_${i}`) || 25 });
    }
    await pl.saveQuote(actor, id, { lines, valid_to: str(fd, 'valid_to'), notes: str(fd, 'notes') });
  });
  done(deal(cid, id), 'Offerten är sparad');
}

export async function sendQuote(cid: number, id: number) {
  const actor = await ctx(cid);
  await attempt(deal(cid, id), async () => { await pl.sendQuote(actor, id, await requestOrigin()); });
  done(deal(cid, id), 'Offerten är skickad för e-signering');
}

export async function invoiceDeal(cid: number, id: number) {
  const actor = await ctx(cid);
  let iid = 0;
  await attempt(deal(cid, id), async () => { iid = (await pl.invoiceDeal(actor, id)).id; });
  done(`/c/${cid}/fakturor/${iid}`, 'Fakturautkastet är skapat från affären');
}

export async function projectFromDeal(cid: number, id: number) {
  const actor = await ctx(cid);
  await attempt(deal(cid, id), () => pl.projectFromDeal(actor, id));
  done(deal(cid, id), 'Projektet är skapat');
}

export async function dealActivity(cid: number, id: number, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(deal(cid, id), () => pl.addDealActivity(actor, id, { kind: str(fd, 'kind'), subject: str(fd, 'subject'), body: str(fd, 'body'), due_date: str(fd, 'due_date') }));
  done(deal(cid, id), 'Aktiviteten är sparad');
}

export async function saveStage(cid: number, id: number | null, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(`/c/${cid}/m/crm/steg`, () => pl.saveStage(actor, id, { name: str(fd, 'name'), probability: str(fd, 'probability'), position: str(fd, 'position'), active: id ? fd.get('active') === 'on' : true }));
  done(`/c/${cid}/m/crm/steg`, 'Steget är sparat');
}
