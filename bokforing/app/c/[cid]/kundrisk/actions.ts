'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as c from '@/lib/services/credit';
import { RISK_LABEL } from '@/lib/credit';

const back = (cid: number) => `/c/${cid}/kundrisk`;
const obj = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
async function run<T>(p: string, fn: () => Promise<T>): Promise<T> { let r!: T; await attempt(p, async () => { r = await fn(); }); return r; }
const actor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'invoicing' }));

export async function check(cid: number, id: number) {
  const a = await actor(cid);
  const r = await run(back(cid), () => c.checkAsUser(a, id));
  done(back(cid), `Kreditupplysningen är hämtad: ${RISK_LABEL[r.risk]}${r.suggested != null ? ` – föreslagen kreditgräns ${(r.suggested / 100).toLocaleString('sv-SE')} kr` : ''}`);
}
export async function limit(cid: number, id: number, fd: FormData) { const a = await actor(cid); await run(back(cid), () => c.setLimit(a, id, obj(fd))); done(back(cid), 'Kreditgränsen är sparad'); }
export async function monitor(cid: number, id: number, on: boolean) { const a = await actor(cid); await run(back(cid), () => c.setMonitor(a, id, on)); done(back(cid), on ? 'Kunden bevakas' : 'Bevakningen är avslutad'); }
export async function auto(cid: number, on: boolean) { const a = userActor(await requireCompany(cid, { owner: true })); await run(back(cid), () => c.setAutoCheck(a, on)); done(back(cid), on ? 'Nya företagskunder kreditkontrolleras automatiskt' : 'Automatisk kreditkontroll är avstängd'); }
