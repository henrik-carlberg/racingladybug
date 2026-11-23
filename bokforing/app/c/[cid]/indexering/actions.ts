'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/indexation';

const base = (cid: number, period?: string) => `/c/${cid}/indexering${period ? `?period=${encodeURIComponent(period)}` : ''}`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const per = (fd: FormData) => String(fd.get('view_period') ?? '') || undefined;

export async function indexAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(base(cid, per(fd)), async () => { await svc.addIndex(actor, form(fd)); });
  done(base(cid, per(fd)), 'Indexvärdet är sparat');
}
export async function linkAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(base(cid, per(fd)), async () => { await svc.link(actor, form(fd)); });
  done(base(cid, per(fd)), 'Avtalet är kopplat till indexet');
}
export async function applyAction(cid: number, period: string, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  let r = { contracts: 0, lines: 0 };
  await attempt(base(cid, period), async () => { r = await svc.apply(actor, period, form(fd)); });
  done(base(cid, period), `Priserna är uppräknade för ${r.contracts} avtal (${r.lines} rader)`);
}
