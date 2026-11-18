'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/absence';

const fields = (fd: FormData) => ({ employee_id: str(fd, 'employee_id'), kind: str(fd, 'kind'), from: str(fd, 'from'), to: str(fd, 'to'), extent: str(fd, 'extent'), note: str(fd, 'note') });

/** Både personal (lon/franvaro) och anställda (mitt/franvaro) registrerar här */
export async function register(cid: number, back: string, fd: FormData) {
  const ctx = await requireCompany(cid, { employee: true });
  let msg = '';
  await attempt(back, async () => {
    const r = await svc.createAbsence(Object.assign(userActor(ctx), { employeeId: ctx.employeeId }), fields(fd));
    msg = r.status === 'requested' ? 'Ansökan är skickad för godkännande' : 'Frånvaron är registrerad';
  });
  done(back, msg);
}

export async function decide(cid: number, id: number, approve: boolean) {
  const actor = userActor(await requireCompany(cid, { perm: 'payroll' }));
  await attempt(`/c/${cid}/lon/franvaro`, () => svc.decide(actor, id, approve));
  done(`/c/${cid}/lon/franvaro`, approve ? 'Ansökan är godkänd' : 'Ansökan är avslagen');
}

export async function remove(cid: number, id: number, back: string) {
  const ctx = await requireCompany(cid, { employee: true });
  await attempt(back, () => svc.removeAbsence(Object.assign(userActor(ctx), { employeeId: ctx.employeeId }), id));
  done(back, 'Frånvaron är borttagen');
}
