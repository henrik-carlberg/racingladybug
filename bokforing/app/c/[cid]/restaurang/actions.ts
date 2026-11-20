'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as s from '@/lib/services/restaurant';

const back = (cid: number, q = '') => `/c/${cid}/restaurang${q}`;
async function run<T>(b: string, fn: () => Promise<T>): Promise<T> { let r!: T; await attempt(b, async () => { r = await fn(); }); return r; }
const obj = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const kr = (o: number) => (o / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2 });

export async function z(cid: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid), () => s.zReport(a, obj(fd)));
  done(back(cid), 'Dagskassan är bokförd');
}
export async function meals(cid: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'payroll' }));
  const q = `?period=${String(fd.get('period') ?? '').replace(/[^\d-]/g, '').slice(0, 7)}#personalmat`;
  const b = await run(back(cid, q), () => s.addMeals(a, obj(fd)));
  done(back(cid, q), `Personalmaten är registrerad – förmånsvärde ${kr(b.value)} kr, skattepliktigt ${kr(b.taxable)} kr`);
}
export async function mealVat(cid: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const q = `?period=${String(fd.get('period') ?? '').replace(/[^\d-]/g, '').slice(0, 7)}#personalmat`;
  const r = await run(back(cid, q), () => s.bookMealVat(a, obj(fd)));
  done(back(cid, q), `Uttagsmomsen ${kr(r.vat)} kr är bokförd för ${r.count} rader`);
}
export async function representation(cid: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const r = await run(back(cid, '#representation'), () => s.representation(a, obj(fd)));
  done(back(cid, '#representation'), `Representationen är bokförd – avdragsgill moms ${kr(r.deductible)} kr av ${kr(r.vat)} kr`);
}
