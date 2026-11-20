'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as p from '@/lib/services/property';

const back = (cid: number) => `/c/${cid}/fastighet`;
const obj = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
async function run<T>(b: string, fn: () => Promise<T>): Promise<T> { let r!: T; await attempt(b, async () => { r = await fn(); }); return r; }
const ledger = async (cid: number) => userActor(await requireCompany(cid, { perm: 'ledger' }));
const invoicing = async (cid: number) => userActor(await requireCompany(cid, { perm: 'invoicing' }));

export async function property(cid: number, fd: FormData) { const a = await ledger(cid); await run(back(cid), () => p.createProperty(a, obj(fd))); done(back(cid), 'Fastigheten är upplagd'); }
export async function premise(cid: number, pid: number, fd: FormData) { const a = await ledger(cid); await run(back(cid), () => p.addPremise(a, pid, obj(fd))); done(back(cid), 'Lokalen är upplagd'); }
export async function premiseVat(cid: number, id: number, fd: FormData) { const a = await ledger(cid); await run(back(cid), () => p.setPremiseVat(a, id, obj(fd))); done(back(cid), 'Momsplikten för lokalen är ändrad'); }
export async function index(cid: number, fd: FormData) { const a = await ledger(cid); await run(back(cid), () => p.setIndex(a, obj(fd))); done(back(cid), 'Indexet är sparat'); }
export async function lease(cid: number, fd: FormData) { const a = await invoicing(cid); await run(back(cid), () => p.createLease(a, obj(fd))); done(back(cid), 'Hyresavtalet är upplagt'); }
export async function deposit(cid: number, id: number, fd: FormData) { const a = await ledger(cid); await run(back(cid), () => p.registerDeposit(a, id, obj(fd))); done(back(cid), 'Depositionen är bokförd som skuld'); }
export async function depositReturn(cid: number, id: number, fd: FormData) { const a = await ledger(cid); await run(back(cid), () => p.returnDeposit(a, id, obj(fd))); done(back(cid), 'Återbetalningen av depositionen är bokförd'); }
export async function rents(cid: number, fd: FormData) { const a = await invoicing(cid); const n = await run(back(cid), () => p.invoiceRents(a, obj(fd))); done(back(cid), `${n} hyresavier är skapade och bokförda`); }
export async function components(cid: number, pid: number, fd: FormData) {
  const a = await ledger(cid);
  const s = await run(back(cid), () => p.registerComponents(a, pid, obj(fd)));
  done(back(cid), `${s.components.length} komponenter är upplagda i anläggningsregistret – avskrivning ${(s.yearlyDepreciation / 100).toLocaleString('sv-SE')} kr per år`);
}
