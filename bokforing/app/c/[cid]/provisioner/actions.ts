'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as c from '@/lib/services/commission';

const back = (cid: number, p?: unknown) => `/c/${cid}/provisioner${p && /^\d{4}-\d{2}$/.test(String(p)) ? `?period=${p}` : ''}`;
const obj = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
async function run<T>(p: string, fn: () => Promise<T>): Promise<T> { let r!: T; await attempt(p, async () => { r = await fn(); }); return r; }
const actor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'payroll' }));

export async function seller(cid: number, fd: FormData) { const a = await actor(cid); await run(back(cid), () => c.addSeller(a, obj(fd))); done(back(cid), 'Säljaren är upplagd'); }
export async function rule(cid: number, fd: FormData) { const a = await actor(cid); await run(back(cid), () => c.addRule(a, obj(fd))); done(back(cid), 'Regeln är sparad'); }
export async function removeRule(cid: number, id: number) { const a = await actor(cid); await run(back(cid), () => c.removeRule(a, id)); done(back(cid), 'Regeln är borttagen'); }
export async function tier(cid: number, sid: number, fd: FormData) { const a = await actor(cid); await run(back(cid), () => c.addTier(a, sid, obj(fd))); done(back(cid), 'Bonussteget är sparat'); }
export async function assign(cid: number, fd: FormData) { const a = await actor(cid); await run(back(cid), () => c.assignCustomer(a, obj(fd))); done(back(cid), 'Kunden har fått säljare'); }
export async function invoiceSeller(cid: number, fd: FormData) { const a = await actor(cid); await run(back(cid), () => c.setInvoiceSeller(a, obj(fd))); done(back(cid), 'Fakturan har fått säljare'); }
export async function settle(cid: number, fd: FormData) { const a = await actor(cid); const p = String(fd.get('period') ?? ''); const n = await run(back(cid, p), () => c.settle(a, p)); done(back(cid, p), `Avräkningen är sparad för ${n} säljare`); }
export async function transfer(cid: number, id: number, period: string) { const a = await actor(cid); await run(back(cid, period), () => c.transfer(a, id)); done(back(cid, period), 'Provisionen är överförd'); }
