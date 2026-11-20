'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as f from '@/lib/services/foreign-pay';

const back = (cid: number) => `/c/${cid}/utlandsbetalningar`;
const obj = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
async function run<T>(p: string, fn: () => Promise<T>): Promise<T> { let r!: T; await attempt(p, async () => { r = await fn(); }); return r; }

export async function supplier(cid: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'purchasing' }));
  const id = Number(fd.get('supplier_id'));
  const pending = await run(back(cid), () => f.setSupplierForeign(a, id, obj(fd)));
  done(back(cid), pending ? 'Uppgifterna är sparade – det nya IBAN/BIC gäller när en annan behörig person har godkänt det under Varningar och kontroll' : 'Uppgifterna för utlandsbetalning är sparade');
}
export async function batch(cid: number) {
  const a = userActor(await requireCompany(cid, { perm: 'payments' }));
  const r = await run(back(cid), () => f.createBatch(a));
  done(`${back(cid)}?batch=${encodeURIComponent(r.batch)}`, `Betalfilen med ${r.count} betalningar är skapad – ladda ner den och ladda upp i internetbanken`);
}
export async function settle(cid: number, id: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'payments' }));
  await run(back(cid), () => f.settle(a, id, obj(fd)));
  done(back(cid), 'Avräkningen är bokförd med kursdifferens och avgift');
}
export async function cancel(cid: number, id: number) {
  const a = userActor(await requireCompany(cid, { perm: 'payments' }));
  await run(back(cid), () => f.cancel(a, id));
  done(back(cid), 'Betalningen är makulerad');
}
