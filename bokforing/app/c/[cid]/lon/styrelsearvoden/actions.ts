'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/board-fees';

const base = (cid: number) => `/c/${cid}/lon/styrelsearvoden`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
export async function addMember(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'payroll' }));
  let note = '';
  await attempt(base(cid), async () => { note = (await svc.addMember(actor, form(fd))).assessment.note; });
  done(base(cid), `Ledamoten är registrerad. ${note}`);
}
export async function payFee(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'payroll' }));
  let r = { via: 'invoice' as 'invoice' | 'payroll', tax: 0, fee: 0, net: 0 };
  await attempt(base(cid), async () => { r = await svc.pay(actor, id, form(fd)); });
  done(base(cid), r.via === 'payroll' ? 'Arvodet är lagt på lönespecen i lönekörningen' : `Arvodet är bokfört: skatteavdrag ${kr(r.tax)} kr, arbetsgivaravgifter ${kr(r.fee)} kr, utbetalt ${kr(r.net)} kr`);
}
