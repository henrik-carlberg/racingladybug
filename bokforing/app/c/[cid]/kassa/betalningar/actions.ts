'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/payproviders';

const back = (cid: number) => `/c/${cid}/kassa/betalningar`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([k, v]) => typeof v === 'string' && !k.startsWith('$')).map(([k, v]) => [k, String(v)]));

export async function connectProvider(cid: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid), () => svc.createProvider(a, form(fd)));
  done(back(cid), 'Kopplingen är sparad – hämta rapporterna med "Hämta nu"');
}
export async function syncNow(cid: number, id: number) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let r = { sales: 0, payouts: 0, errors: 0, matched: 0 };
  await attempt(back(cid), async () => { r = await svc.syncProvider(a, id); });
  done(back(cid), `${r.sales} dagsrapporter och ${r.payouts} utbetalningar bokförda, ${r.matched} avstämda mot banken${r.errors ? `, ${r.errors} att kontrollera` : ''}`);
}
export async function toggleProvider(cid: number, id: number, active: boolean) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid), () => svc.setProviderActive(a, id, active));
  done(back(cid), active ? 'Kopplingen är aktiv' : 'Kopplingen är pausad');
}
