'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as l from '@/lib/services/leasing';

const back = (cid: number) => `/c/${cid}/leasing`;
const obj = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
async function run<T>(p: string, fn: () => Promise<T>): Promise<T> { let r!: T; await attempt(p, async () => { r = await fn(); }); return r; }
const actor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'ledger' }));

export async function create(cid: number, fd: FormData) { const a = await actor(cid); await run(back(cid), () => l.createContract(a, obj(fd))); done(back(cid), fd.get('treatment') === 'financial' ? 'Avtalet är upplagt och tillgång och leasingskuld är bokförda' : 'Leasingavtalet är upplagt'); }
export async function book(cid: number, fd: FormData) { const a = await actor(cid); const n = await run(back(cid), () => l.bookDue(a, String(fd.get('upto') ?? ''))); done(back(cid), `${n} leasingavgifter är bokförda`); }
export async function end(cid: number, id: number, fd: FormData) { const a = await actor(cid); await run(back(cid), () => l.endContract(a, id, obj(fd))); done(back(cid), 'Avtalet är avslutat'); }
