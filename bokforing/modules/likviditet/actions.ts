'use server';
import { amount, attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { isModuleEnabled } from '@/lib/modules/enabled';
import { userActor } from '@/lib/services/actor';
import * as svc from './service';
import { CATEGORIES } from './calc';

async function ctx(cid: number) {
  const c = await requireCompany(cid);
  if (!(await isModuleEnabled(c.company.id, 'likviditet'))) throw new Error('Likviditetsmodulen är inte aktiverad');
  return userActor(c);
}
const base = (cid: number) => `/c/${cid}/m/likviditet`;

export async function saveBudget(cid: number, year: number, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(`${base(cid)}/budget?ar=${year}`, () => svc.saveBudget(actor, year,
    Object.fromEntries(CATEGORIES.map((c) => [c.key, [...Array(12)].map((_, i) => amount(fd, `${c.key}_${i + 1}`, c.label))]))));
  done(`${base(cid)}/budget?ar=${year}`, 'Budgeten är sparad');
}

export async function fromLastYear(cid: number, year: number, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(`${base(cid)}/budget?ar=${year}`, () => svc.budgetFromLastYear(actor, year, Number(str(fd, 'percent').replace(',', '.') || '0')));
  done(`${base(cid)}/budget?ar=${year}`, 'Budgeten är ifylld från förra årets utfall');
}

export async function addItem(cid: number, fd: FormData) {
  const actor = await ctx(cid);
  const sign = str(fd, 'direction') === 'in' ? 1 : -1;
  await attempt(base(cid), async () => {
    const a = amount(fd, 'amount', 'Belopp');
    await svc.addItem(actor, { date: str(fd, 'date'), amount: a == null ? null : sign * Math.abs(a), description: str(fd, 'description'), recurrence: str(fd, 'recurrence'), until: str(fd, 'until') });
  });
  done(base(cid), 'Posten är tillagd i prognosen');
}

export async function removeItem(cid: number, id: number) {
  const actor = await ctx(cid);
  await attempt(base(cid), () => svc.removeItem(actor, id));
  done(base(cid), 'Posten är borttagen');
}

export async function saveSettings(cid: number, fd: FormData) {
  const actor = await ctx(cid);
  await attempt(base(cid), () => svc.saveSettings(actor, {
    prelskatt_monthly: amount(fd, 'prelskatt_monthly', 'Preliminärskatt') ?? 0, payment_delay: str(fd, 'payment_delay') || 0, min_balance: amount(fd, 'min_balance', 'Lägsta saldo') ?? 0,
  }));
  done(base(cid), 'Inställningarna är sparade');
}
