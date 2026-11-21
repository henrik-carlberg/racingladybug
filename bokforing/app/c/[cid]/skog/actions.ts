'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/forest';

const base = (cid: number, y: string) => `/c/${cid}/skog?ar=${encodeURIComponent(y)}`;
const run = (msg: string, fn: (a: ReturnType<typeof userActor>, i: Record<string, string>) => Promise<unknown>) => async (cid: number, fd: FormData) => {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const input = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
  const y = input.tax_year ?? input.date?.slice(0, 4) ?? '';
  await attempt(base(cid, y), () => fn(actor, input));
  done(base(cid, y), msg);
};
export const saveSettings = run('Uppgifterna om skogen är sparade', svc.saveSettings);
export const addSale = run('Likviden är registrerad', svc.addSale);
export const deposit = run('Insättningen är bokförd', svc.deposit);
export const withdraw = run('Uttaget är bokfört och tas upp som intäkt i årets deklaration', svc.withdraw);
export const setDeduction = run('Skogsavdraget är sparat', svc.setDeduction);
