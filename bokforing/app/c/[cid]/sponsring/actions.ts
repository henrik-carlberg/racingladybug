'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/sponsorship';

const base = (cid: number) => `/c/${cid}/sponsring`;
export async function register(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const input = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
  let r = { deductible: false, per: 0 };
  await attempt(base(cid), async () => { r = await svc.register(actor, input); });
  done(base(cid), r.deductible ? 'Bokfört som avdragsgill kostnad med avdrag för momsen'
    : input.kind === 'gift' ? `Bokfört som ej avdragsgill gåva: ${kr(r.per)} kr per mottagare är mer än obetydligt värde, och momsen får inte dras av`
    : 'Bokfört som ej avdragsgill gåva: sponsring utan motprestation, och momsen får inte dras av');
}
