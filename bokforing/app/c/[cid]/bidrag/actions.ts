'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as s from '@/lib/services/company-grants';

const back = (cid: number) => `/c/${cid}/bidrag`;
async function run<T>(b: string, fn: () => Promise<T>): Promise<T> { let r!: T; await attempt(b, async () => { r = await fn(); }); return r; }
const obj = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const kr = (o: number) => (o / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2 });

export async function create(cid: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid), () => s.create(a, obj(fd)));
  done(back(cid), 'Bidraget är registrerat');
}
export async function receive(cid: number, id: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid), () => s.receive(a, id, obj(fd)));
  done(back(cid), 'Utbetalningen är bokförd');
}
export async function recognize(cid: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const r = await run(back(cid), () => s.recognize(a, obj(fd)));
  done(back(cid), r.count ? `${r.count} bidrag är intäktsförda mot kostnaderna (${kr(r.total)} kr)` : 'Inga förändringar att bokföra');
}
export async function risk(cid: number, id: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid), () => s.assessRisk(a, id, obj(fd)));
  done(back(cid), fd.get('risk') === 'probable' ? 'Återbetalningsskulden är bokförd' : 'Bedömningen är sparad');
}
export async function repay(cid: number, id: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid), () => s.repay(a, id, obj(fd)));
  done(back(cid), 'Återbetalningen är bokförd');
}
