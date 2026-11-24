'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/trainings';

const base = (cid: number) => `/c/${cid}/lon/utbildning`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function addAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'payroll' }));
  let r = { until: null as string | null, benefit: 0, booked: false };
  await attempt(base(cid), async () => { r = await svc.add(actor, form(fd)); });
  done(base(cid), `Utbildningen är registrerad${r.until ? `, giltig till ${r.until}` : ''}${r.booked ? ' och kostnaden är bokförd på 7610' : ''}${r.benefit ? `. Den är inte arbetsrelaterad – ${kr(r.benefit)} kr ska tas upp som skattepliktig förmån i lönen` : ''}`);
}
