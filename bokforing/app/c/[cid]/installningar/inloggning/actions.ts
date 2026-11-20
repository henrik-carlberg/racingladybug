'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as s from '@/lib/services/company-login';

const back = (cid: number) => `/c/${cid}/installningar/inloggning`;
const obj = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const owner = async (cid: number) => userActor(await requireCompany(cid, { owner: true }));

export async function saveSso(cid: number, fd: FormData) { const a = await owner(cid); await attempt(back(cid), () => s.saveSso(a, obj(fd))); done(back(cid), 'Företagsinloggningen är sparad och leverantören svarar'); }
export async function removeSso(cid: number) { const a = await owner(cid); await attempt(back(cid), () => s.removeSso(a)); done(back(cid), 'Företagsinloggningen är borttagen'); }
export async function requireMfa(cid: number, on: boolean) { const a = await owner(cid); await attempt(back(cid), () => s.setRequireMfa(a, on)); done(back(cid), on ? 'Alla måste nu använda tvåstegsverifiering i bolaget' : 'Tvåstegsverifiering krävs inte längre'); }
export async function ipList(cid: number, fd: FormData) { const a = await owner(cid); await attempt(back(cid), () => s.setIpAllowlist(a, obj(fd))); done(back(cid), 'IP-begränsningen är sparad'); }
export async function block(cid: number, ref: string) { const a = await owner(cid); await attempt(back(cid), () => s.blockSession(a, ref)); done(back(cid), 'Sessionen är utloggad från bolaget'); }
