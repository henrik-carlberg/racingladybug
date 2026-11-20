'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as p from '@/lib/services/poc';

const back = (cid: number) => `/c/${cid}/successiv`;
const obj = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const actor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'ledger' }));
export async function create(cid: number, fd: FormData) { const a = await actor(cid); await attempt(back(cid), () => p.createContract(a, obj(fd))); done(back(cid), 'Fastprisuppdraget är upplagt'); }
export async function estimate(cid: number, id: number, fd: FormData) { const a = await actor(cid); await attempt(back(cid), () => p.updateEstimate(a, id, obj(fd))); done(back(cid), 'Uppdraget är uppdaterat'); }
export async function part(cid: number, id: number, fd: FormData) { const a = userActor(await requireCompany(cid, { perm: 'invoicing' })); await attempt(back(cid), () => p.invoicePart(a, id, obj(fd))); done(back(cid), 'Delfakturan är skapad och bokförd'); }
export async function book(cid: number, fd: FormData) { const a = await actor(cid); await attempt(back(cid), () => p.book(a, obj(fd))); done(`${back(cid)}?date=${encodeURIComponent(String(fd.get('date') ?? ''))}`, 'Bokslutsjusteringen är bokförd'); }
