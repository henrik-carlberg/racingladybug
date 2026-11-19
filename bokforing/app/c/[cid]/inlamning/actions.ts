'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import type { Permission } from '@/lib/permissions';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/filings';
import { sql } from '@/lib/db';

const base = (cid: number) => `/c/${cid}/inlamning`;
const permFor = async (cid: number, id: number): Promise<Permission> => {
  const [f] = await sql<{ kind: string }[]>`SELECT kind FROM filings WHERE id = ${id} AND company_id = ${cid}`;
  return f?.kind === 'agi' ? 'payroll' : 'ledger';
};

export async function prepareVat(cid: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(`/c/${cid}/rapporter/moms`, () => svc.prepareVat(a, str(fd, 'from'), str(fd, 'to')));
  done(base(cid), 'Momsdeklarationen är förberedd – kontrollera och lämna in');
}
export async function prepareAgi(cid: number, runId: number) {
  const a = userActor(await requireCompany(cid, { perm: 'payroll' }));
  await attempt(`/c/${cid}/lon/${runId}`, () => svc.prepareAgi(a, runId));
  done(base(cid), 'Arbetsgivardeklarationen är förberedd – kontrollera och lämna in');
}
export async function prepareAnnual(cid: number, fyId: number) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(`/c/${cid}/bokslut/${fyId}/arsredovisning`, () => svc.prepareAnnualReport(a, fyId));
  done(base(cid), 'Årsredovisningen är förberedd för digital inlämning');
}
export async function submit(cid: number, id: number) {
  const a = userActor(await requireCompany(cid, { perm: await permFor(cid, id) }));
  let s = { status: '' } as { status: string; message?: string };
  await attempt(base(cid), async () => { s = await svc.submitFiling(a, id); });
  done(base(cid), s.status === 'accepted' ? 'Inlämnad och godkänd' : s.status === 'rejected' ? `Avvisad: ${s.message ?? ''}` : 'Inlämnad – väntar på besked från myndigheten');
}
export async function refresh(cid: number, id: number) {
  const a = userActor(await requireCompany(cid, { perm: await permFor(cid, id) }));
  await attempt(base(cid), () => svc.refreshFiling(a, id));
  done(base(cid), 'Status uppdaterad');
}
export async function markFiled(cid: number, id: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: await permFor(cid, id) }));
  await attempt(base(cid), () => svc.markFiled(a, id, str(fd, 'receipt')));
  done(base(cid), 'Registrerad som inlämnad – deadlinen är klar');
}
