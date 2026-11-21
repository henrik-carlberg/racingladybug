'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { save } from '@/lib/services/special-tax';

export async function saveSpecialTax(cid: number, eid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'payroll' }));
  const back = `/c/${cid}/lon/sarskild-skatt`;
  await attempt(back, () => save(actor, eid, Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]))));
  done(back, 'Beslutet är sparat – det används när lönespecarna räknas om');
}
