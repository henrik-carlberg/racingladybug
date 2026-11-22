'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/ef-pension';

const form = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
export async function saveSettings(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const input = form(fd);
  const base = `/c/${cid}/pensionssparande?ar=${input.year}`;
  await attempt(base, () => svc.saveSettings(actor, input));
  done(base, 'Uppgifterna är sparade');
}
export async function pay(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const input = form(fd);
  const base = `/c/${cid}/pensionssparande?ar=${String(input.date).slice(0, 4)}`;
  await attempt(base, () => svc.pay(actor, input));
  done(base, 'Premien är bokförd som privat uttag och räknas av mot avdragsutrymmet');
}
