'use server';
import { amount, attempt, done, fileFrom, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { isModuleEnabled } from '@/lib/modules/enabled';
import { userActor } from '@/lib/services/actor';
import * as svc from './service';

async function ctx(cid: number) {
  const c = await requireCompany(cid);
  if (!(await isModuleEnabled(c.company.id, 'utlagg'))) throw new Error('Utläggsmodulen är inte aktiverad');
  return userActor(c);
}
const base = (cid: number) => `/c/${cid}/m/utlagg`;
const one = (cid: number, id: number) => `${base(cid)}/r/${id}`;

export async function create(cid: number, fd: FormData) {
  const actor = await ctx(cid);
  let id = 0;
  await attempt(base(cid), async () => { id = (await svc.createClaim(actor, { employee_id: str(fd, 'employee_id'), title: str(fd, 'title') })).id; });
  done(one(cid, id), 'Utläggsräkningen är skapad – lägg till kvitton, resor och traktamenten');
}

export async function addLine(cid: number, id: number, kind: string, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(one(cid, id), async () => {
    await svc.addLine(actor, id, {
      kind, date: str(fd, 'date'), description: str(fd, 'description'), category: str(fd, 'category'), amount: kind === 'receipt' ? amount(fd, 'amount', 'Belopp') : undefined,
      km: str(fd, 'km'), days_full: str(fd, 'days_full'), days_half: str(fd, 'days_half'), nights: str(fd, 'nights'),
    }, await fileFrom(fd));
  });
  done(one(cid, id), 'Raden är tillagd');
}

export async function removeLine(cid: number, id: number, lineId: number) {
  const actor = await ctx(cid);
  await attempt(one(cid, id), () => svc.removeLine(actor, id, lineId));
  done(one(cid, id), 'Raden är borttagen');
}

export async function submit(cid: number, id: number) {
  const actor = await ctx(cid);
  await attempt(one(cid, id), () => svc.submit(actor, id));
  done(one(cid, id), 'Räkningen är inskickad för attest');
}

export async function approve(cid: number, id: number) {
  const actor = await ctx(cid);
  await attempt(one(cid, id), () => svc.approve(actor, id));
  done(one(cid, id), 'Räkningen är attesterad och bokförd');
}

export async function reject(cid: number, id: number, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(one(cid, id), () => svc.reject(actor, id, str(fd, 'comment')));
  done(one(cid, id), 'Räkningen är avslagen och kan ändras');
}

export async function payPayroll(cid: number, id: number, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(one(cid, id), () => svc.payViaPayroll(actor, id, Number(str(fd, 'run_id'))));
  done(one(cid, id), 'Utlägget betalas ut med lönen');
}

export async function payDirect(cid: number, id: number, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(one(cid, id), () => svc.payDirect(actor, id, { date: str(fd, 'date') }));
  done(one(cid, id), 'Utbetalningen är bokförd');
}

export async function saveSettings(cid: number, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(`${base(cid)}/installningar`, () => svc.saveSettings(actor, {
    mileage_rate: amount(fd, 'mileage_rate', 'Milersättning'), allowance_full: amount(fd, 'allowance_full', 'Heldag'), allowance_half: amount(fd, 'allowance_half', 'Halvdag'),
    allowance_night: amount(fd, 'allowance_night', 'Natt'), liability_account: str(fd, 'liability_account'), mileage_account: str(fd, 'mileage_account'), allowance_account: str(fd, 'allowance_account'),
  }));
  done(`${base(cid)}/installningar`, 'Inställningarna är sparade');
}
