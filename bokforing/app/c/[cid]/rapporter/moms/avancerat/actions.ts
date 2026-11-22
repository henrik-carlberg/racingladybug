'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as s from '@/lib/services/vat-advanced';

const back = (cid: number, h = '') => `/c/${cid}/rapporter/moms/avancerat${h}`;
async function run<T>(b: string, fn: () => Promise<T>): Promise<T> { let r!: T; await attempt(b, async () => { r = await fn(); }); return r; }
const obj = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const kr = (o: number) => (o / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2 });

export async function settings(cid: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid), () => s.saveSettings(a, obj(fd)));
  done(back(cid), 'Inställningarna för blandad verksamhet är sparade');
}
export async function proportion(cid: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const r = await run(back(cid), () => s.bookProportion(a, obj(fd)));
  done(back(cid), `${kr(r.nonDeductible)} kr av den gemensamma ingående momsen (${kr(r.commonVat)} kr) är förd till kostnad`);
}
export async function investment(cid: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid, '#jamkning'), () => s.addInvestment(a, obj(fd)));
  done(back(cid, '#jamkning'), 'Investeringen är registrerad');
}
export async function adjust(cid: number, id: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const r = await run(back(cid, '#jamkning'), () => s.adjust(a, id, obj(fd)));
  done(back(cid, '#jamkning'), `Jämkningen är bokförd: ${r.amount > 0 ? 'ytterligare avdrag' : 'återbetalning'} ${kr(Math.abs(r.amount))} kr`);
}

export async function dispose(cid: number, id: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const r = await run(back(cid, '#jamkning'), () => s.dispose(a, id, obj(fd)));
  done(back(cid, '#jamkning'), r.amount ? `Slutjämkningen är bokförd för ${r.remaining} år: ${r.amount > 0 ? 'ytterligare avdrag' : 'återbetalning'} ${kr(Math.abs(r.amount))} kr` : 'Avyttringen är registrerad – ingen jämkning behövs');
}
