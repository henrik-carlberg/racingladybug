'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as b from '@/lib/services/brf';

const back = (cid: number) => `/c/${cid}/brf`;
const obj = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
async function run<T>(p: string, fn: () => Promise<T>): Promise<T> { let r!: T; await attempt(p, async () => { r = await fn(); }); return r; }
const ledger = async (cid: number) => userActor(await requireCompany(cid, { perm: 'ledger' }));
const invoicing = async (cid: number) => userActor(await requireCompany(cid, { perm: 'invoicing' }));

export async function toggle(cid: number, v: boolean) { const a = userActor(await requireCompany(cid, { owner: true })); await run(back(cid), () => b.setBrf(a, v)); done(back(cid), v ? 'Bostadsrättsföreningsläget är på' : 'Bostadsrättsföreningsläget är av'); }
export async function apartment(cid: number, fd: FormData) { const a = await ledger(cid); await run(back(cid), () => b.addApartment(a, obj(fd))); done(back(cid), 'Lägenheten är införd i förteckningen'); }
export async function transfer(cid: number, id: number, fd: FormData) { const a = await ledger(cid); await run(back(cid), () => b.transfer(a, id, obj(fd))); done(back(cid), 'Överlåtelsen är registrerad'); }
export async function pledge(cid: number, id: number, fd: FormData) { const a = await ledger(cid); await run(back(cid), () => b.addPledge(a, id, obj(fd))); done(back(cid), 'Pantsättningen är noterad'); }
export async function release(cid: number, id: number) { const a = await ledger(cid); await run(back(cid), () => b.releasePledge(a, id)); done(back(cid), 'Pantsättningen är avregistrerad'); }
export async function budget(cid: number, fd: FormData) { const a = await ledger(cid); await run(back(cid), () => b.setBudget(a, obj(fd))); done(back(cid), 'Årets avgifter är sparade'); }
export async function fees(cid: number, fd: FormData) { const a = await invoicing(cid); const n = await run(back(cid), () => b.invoiceFees(a, obj(fd))); done(back(cid), `${n} avgiftsavier är skapade och bokförda`); }
export async function maintenance(cid: number, fd: FormData) { const a = await ledger(cid); await run(back(cid), () => b.addMaintenance(a, obj(fd))); done(back(cid), 'Åtgärden är införd i underhållsplanen'); }
export async function maintenanceDone(cid: number, id: number) { const a = await ledger(cid); await run(back(cid), () => b.markMaintenanceDone(a, id)); done(back(cid), 'Åtgärden är markerad som utförd'); }
export async function fund(cid: number, fd: FormData) { const a = await ledger(cid); await run(back(cid), () => b.fund(a, obj(fd))); done(back(cid), fd.get('kind') === 'use' ? 'Fonden är ianspråktagen' : 'Avsättningen till fonden är bokförd'); }
