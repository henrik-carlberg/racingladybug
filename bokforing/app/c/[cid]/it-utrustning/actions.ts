'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/it-equipment';

const base = (cid: number) => `/c/${cid}/it-utrustning`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function addAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(base(cid), async () => { await svc.add(actor, form(fd)); });
  done(base(cid), 'Utrustningen är registrerad');
}
export async function assignAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(base(cid), async () => { await svc.assign(actor, id, form(fd)); });
  done(base(cid), 'Utrustningen är utlämnad');
}
export async function closeAction(cid: number, id: number, action: 'returned' | 'lost' | 'retired', fd: FormData) {
  if (!['returned', 'lost', 'retired'].includes(action)) throw new Error('Ogiltig åtgärd');
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let name = '';
  await attempt(base(cid), async () => { name = await svc.close(actor, id, action, form(fd)); });
  done(base(cid), action === 'returned' ? `${name} är återlämnad` : action === 'lost' ? `${name} är registrerad som förlorad` : `${name} är kasserad`);
}
