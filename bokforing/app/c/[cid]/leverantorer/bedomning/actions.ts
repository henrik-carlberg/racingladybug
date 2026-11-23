'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { CHECKS } from '@/lib/supplier-assessment';
import * as svc from '@/lib/services/supplier-assessment';

const base = (cid: number) => `/c/${cid}/leverantorer/bedomning`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function riskAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'purchasing' }));
  await attempt(base(cid), async () => { await svc.setRisk(actor, id, form(fd)); });
  done(base(cid), 'Risknivån är sparad');
}
export async function checkAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'purchasing' }));
  let r = { kind: '', until: '' };
  await attempt(base(cid), async () => { r = await svc.addCheck(actor, id, form(fd)); });
  done(base(cid), `${CHECKS[r.kind]} är registrerad, giltig till ${r.until}`);
}
