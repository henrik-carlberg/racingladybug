'use server';
import { amount, attempt, done, fileFrom, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { isModuleEnabled } from '@/lib/modules/enabled';
import { userActor } from '@/lib/services/actor';
import * as svc from './service';

async function ctx(cid: number, claimId?: number) {
  const c = await requireCompany(cid, { employee: true });
  if (!(await isModuleEnabled(c.company.id, 'utlagg'))) throw new Error('Utläggsmodulen är inte aktiverad');
  if (c.role === 'employee' && claimId) {
    const cl = await svc.getClaim(c.company.id, claimId);
    if (cl.employee_id !== c.employeeId) throw new Error('Du kan bara ändra dina egna utlägg');
  }
  return Object.assign(userActor(c), { employeeId: c.employeeId });
}
const base = (cid: number) => `/c/${cid}/m/utlagg`;
const one = (cid: number, id: number) => `${base(cid)}/r/${id}`;

export async function create(cid: number, fd: FormData) {
  const actor = await ctx(cid);
  let id = 0;
  await attempt(base(cid), async () => {
    if (actor.role === 'employee' && !actor.employeeId) throw new Error('Ditt konto är inte kopplat till en anställd');
    id = (await svc.createClaim(actor, { employee_id: actor.role === 'employee' ? actor.employeeId : str(fd, 'employee_id'), title: str(fd, 'title') })).id;
  });
  done(one(cid, id), 'Utläggsräkningen är skapad – lägg till kvitton, resor och traktamenten');
}

export async function addLine(cid: number, id: number, kind: string, fd: FormData) {
  const actor = await ctx(cid, id);
  await attempt(one(cid, id), async () => {
    await svc.addLine(actor, id, {
      kind, date: str(fd, 'date'), description: str(fd, 'description'), category: str(fd, 'category'), amount: kind === 'receipt' ? amount(fd, 'amount', 'Belopp') : undefined,
      km: str(fd, 'km'), days_full: str(fd, 'days_full'), days_half: str(fd, 'days_half'), nights: str(fd, 'nights'), depart: str(fd, 'depart'), return: str(fd, 'return'),
    }, await fileFrom(fd));
  });
  done(one(cid, id), 'Raden är tillagd');
}

export async function removeLine(cid: number, id: number, lineId: number) {
  const actor = await ctx(cid, id);
  await attempt(one(cid, id), () => svc.removeLine(actor, id, lineId));
  done(one(cid, id), 'Raden är borttagen');
}

export async function submit(cid: number, id: number) {
  const actor = await ctx(cid, id);
  await attempt(one(cid, id), () => svc.submit(actor, id));
  done(one(cid, id), 'Räkningen är inskickad för attest');
}

export async function approve(cid: number, id: number) {
  const actor = await ctx(cid, id);
  await attempt(one(cid, id), () => svc.approve(actor, id));
  done(one(cid, id), 'Räkningen är attesterad och bokförd');
}

export async function reject(cid: number, id: number, fd: FormData) {
  const actor = await ctx(cid, id);
  await attempt(one(cid, id), () => svc.reject(actor, id, str(fd, 'comment')));
  done(one(cid, id), 'Räkningen är avslagen och kan ändras');
}

const notEmployee = (actor: { role: string }) => { if (actor.role === 'employee') throw new Error('Bara ägare och redovisningskonsult kan betala ut utlägg'); };

export async function payPayroll(cid: number, id: number, fd: FormData) {
  const actor = await ctx(cid, id);
  notEmployee(actor);
  await attempt(one(cid, id), () => svc.payViaPayroll(actor, id, Number(str(fd, 'run_id'))));
  done(one(cid, id), 'Utlägget betalas ut med lönen');
}

export async function payDirect(cid: number, id: number, fd: FormData) {
  const actor = await ctx(cid, id);
  notEmployee(actor);
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

/** Utbetalning via banken: godkänns med BankID i banken, bokförs när banken har genomfört den */
export async function payBank(cid: number, id: number, fd: FormData) {
  await ctx(cid, id);
  const c = await requireCompany(cid, { perm: 'payments' });
  const { payExpense } = await import('@/lib/services/bankpay');
  const { requestOrigin } = await import('@/lib/server/origin');
  const { redirect } = await import('next/navigation');
  let url = '';
  await attempt(one(cid, id), async () => { url = (await payExpense(userActor(c), id, Number(fd.get('pay_account')), await requestOrigin())).url; });
  if (!/^https?:\/\//.test(url)) done(one(cid, id), 'Betalningen kunde inte startas');
  redirect(url);
}

export async function refreshBank(cid: number, id: number) {
  await ctx(cid, id);
  const c = await requireCompany(cid, { perm: 'payments' });
  const { refreshPayments } = await import('@/lib/services/bankpay');
  await attempt(one(cid, id), () => refreshPayments(c.company.id, 'expense'));
  done(one(cid, id), 'Status hämtad från banken');
}

export async function claimTrips(cid: number, id: number) {
  const actor = await ctx(cid, id);
  let n = 0;
  await attempt(one(cid, id), async () => { n = await svc.claimTrips(actor, id); });
  done(one(cid, id), `${n} resor från körjournalen är tillagda`);
}

const journal = (cid: number) => `${base(cid)}/korjournal`;
export async function addTrip(cid: number, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(journal(cid), async () => {
    const emp = actor.role === 'employee' ? actor.employeeId : Number(str(fd, 'employee_id'));
    if (!emp) throw new Error('Ditt konto är inte kopplat till en anställd');
    await svc.addTrip(actor, emp, { date: str(fd, 'date'), from: str(fd, 'from'), to: str(fd, 'to'), purpose: str(fd, 'purpose'), km: str(fd, 'km'),
      odo_start: str(fd, 'odo_start'), odo_end: str(fd, 'odo_end'), vehicle: str(fd, 'vehicle') });
  });
  done(journal(cid), 'Resan är sparad i körjournalen');
}

export async function removeTrip(cid: number, tripId: number) {
  const actor = await ctx(cid);
  await attempt(journal(cid), () => svc.removeTrip(actor, tripId, actor.role === 'employee' ? actor.employeeId ?? -1 : undefined));
  done(journal(cid), 'Resan är borttagen');
}
