'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as c from '@/lib/services/customs';
import { kr } from '@/lib/format';

const back = (cid: number) => `/c/${cid}/tull`;
const obj = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
async function run<T>(b: string, fn: () => Promise<T>): Promise<T> { let r!: T; await attempt(b, async () => { r = await fn(); }); return r; }
const actor = async (cid: number) => userActor(await requireCompany(cid, { perm: 'ledger' }));

export async function decision(cid: number, fd: FormData) {
  const a = await actor(cid);
  const r = await run(back(cid), () => c.registerDecision(a, obj(fd)));
  done(back(cid), `Beslutet är bokfört: underlag ${kr(r.base)} kr i ruta 50 och importmoms ${kr(r.vat)} kr${r.mismatch ? ' – obs! momsen avviker från beslutet, kontrollera underlaget' : ''}`);
}
export async function allocate(cid: number, id: number, fd: FormData) {
  const a = await actor(cid);
  const r = await run(back(cid), () => c.allocateDecision(a, id, obj(fd)));
  done(back(cid), `${kr(r.extra)} kr i tull och frakt är fördelat på ${r.products} artiklar, varav ${kr(r.toInventory)} kr till lagervärdet`);
}
export async function statement(cid: number, fd: FormData) {
  const a = await actor(cid);
  await run(back(cid), () => c.setStatement(a, obj(fd)));
  done(back(cid), 'Tullverkets besked är sparat');
}
