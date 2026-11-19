'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { applyHours, saveAgreement } from '@/lib/services/agreements';

const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([k, v]) => typeof v === 'string' && !k.startsWith('$')).map(([k, v]) => [k, String(v)]));

export async function save(cid: number, id: number | null, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'payroll' }));
  await attempt(`/c/${cid}/lon/avtal`, () => saveAgreement(a, id, form(fd)));
  done(`/c/${cid}/lon/avtal`, 'Avtalet är sparat');
}
export async function hours(cid: number, runId: number, slipId: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'payroll' }));
  const back = `/c/${cid}/lon/${runId}`;
  await attempt(back, () => applyHours(a, runId, slipId, form(fd)));
  done(`${back}#p${slipId}`, 'Tilläggen enligt avtalet är beräknade');
}
