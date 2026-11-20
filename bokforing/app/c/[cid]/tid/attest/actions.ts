'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as s from '@/lib/services/time-flow';

const back = (cid: number, q = '') => `/c/${cid}/tid/attest${q}`;
const obj = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const q = (fd: FormData) => `?from=${String(fd.get('from') ?? '').slice(0, 10)}&to=${String(fd.get('to') ?? '').slice(0, 10)}`;

export async function approval(cid: number, on: boolean) {
  const a = userActor(await requireCompany(cid, { owner: true }));
  await attempt(back(cid), () => s.setApproval(a, on));
  done(back(cid), on ? 'Attest krävs nu innan tid faktureras eller förs till lönen' : 'Attest krävs inte längre för fakturering');
}
export async function approve(cid: number, fd: FormData) {
  const ctx = await requireCompany(cid, { perm: 'payroll' });
  const a = userActor(ctx);
  let n = 0;
  await attempt(back(cid, q(fd)), async () => { n = await s.approve(ctx, a, obj(fd)); });
  done(back(cid, q(fd)), `${n} tidrader är attesterade`);
}
export async function reopen(cid: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'payroll' }));
  let n = 0;
  await attempt(back(cid, q(fd)), async () => { n = await s.reopen(a, obj(fd)); });
  done(back(cid, q(fd)), `${n} tidrader är öppnade igen`);
}
export async function toPayroll(cid: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'payroll' }));
  let r = { moved: 0, skipped: [] as string[] };
  await attempt(back(cid, q(fd)), async () => { r = await s.toPayroll(a, Number(fd.get('run_id'))); });
  done(back(cid, q(fd)), `${r.moved} tidrader är förda till lönekörningen${r.skipped.length ? ` – saknar kollektivavtal: ${r.skipped.join(', ')}` : ''}`);
}
