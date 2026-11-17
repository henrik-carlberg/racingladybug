'use server';
import { amount, attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/time';

const list = (cid: number) => `/c/${cid}/uppdrag`;
const one = (cid: number, pid: number) => `/c/${cid}/uppdrag/${pid}`;

export async function createProject(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  let id = 0;
  await attempt(list(cid), async () => {
    const p = await svc.createProject(actor, {
      customer_id: str(fd, 'customer_id'), name: str(fd, 'name'), billing: str(fd, 'billing'),
      hourly_rate: amount(fd, 'hourly_rate', 'Timpris') ?? 0, vat_rate: str(fd, 'vat_rate') || 25, activities: str(fd, 'activities'), notes: str(fd, 'notes'),
    });
    id = p.id;
  });
  done(one(cid, id), 'Uppdraget är skapat');
}

export async function updateProject(cid: number, pid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  await attempt(one(cid, pid), () => svc.updateProject(actor, pid, {
    name: str(fd, 'name'), billing: str(fd, 'billing'), hourly_rate: amount(fd, 'hourly_rate', 'Timpris') ?? 0,
    active: fd.get('active') === 'on', notes: str(fd, 'notes'),
  }));
  done(one(cid, pid), 'Uppdraget är sparat');
}

export async function saveActivity(cid: number, pid: number, aid: number | null, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  await attempt(one(cid, pid), () => svc.saveActivity(actor, pid, aid, {
    name: str(fd, 'name'), hourly_rate: str(fd, 'hourly_rate') === '' ? null : amount(fd, 'hourly_rate', 'Timpris'),
    billable: fd.get('billable') === 'on', active: aid ? fd.get('active') === 'on' : true,
  }));
  done(one(cid, pid), aid ? 'Aktiviteten är sparad' : 'Aktiviteten är tillagd');
}

export async function invoiceTime(cid: number, pid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  let id = 0;
  await attempt(one(cid, pid), async () => {
    id = (await svc.invoiceTime(actor, pid, { from: str(fd, 'from'), to: str(fd, 'to'), invoice_date: str(fd, 'invoice_date') })).id;
  });
  done(`/c/${cid}/fakturor/${id}`, 'Fakturaunderlaget är skapat som utkast. Granska och bokför fakturan.');
}

export async function buyHourBank(cid: number, pid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  let id = 0;
  await attempt(one(cid, pid), async () => {
    id = (await svc.buyHourBank(actor, pid, { hours: str(fd, 'hours'), hourly_rate: amount(fd, 'hourly_rate', 'Timpris'), date: str(fd, 'date') })).id;
  });
  done(`/c/${cid}/fakturor/${id}`, 'Fakturan för timbanken är skapad som utkast. Timmarna räknas in när fakturan är bokförd.');
}

export async function bankStatement(cid: number, pid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  let id = 0;
  await attempt(one(cid, pid), async () => { id = (await svc.bankStatementInvoice(actor, pid, { period: str(fd, 'period') })).id; });
  done(`/c/${cid}/fakturor/${id}`, 'Avräkningen är skapad som utkast. Granska och bokför den.');
}

export async function allBankStatements(cid: number, period: string) {
  const actor = userActor(await requireCompany(cid));
  let n = 0;
  await attempt(list(cid), async () => { n = await svc.createBankStatements(actor, period); });
  done(`/c/${cid}/fakturor?status=draft`, `${n} avräkningar är skapade som utkast`);
}
