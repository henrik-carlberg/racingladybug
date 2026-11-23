'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/trade-finance';

const base = (cid: number) => `/c/${cid}/remburser`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function createAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let r = { id: 0, guarantee: 0, pledge: 0 };
  await attempt(base(cid), async () => { r = await svc.create(actor, form(fd)); });
  done(base(cid), `Registrerat${r.guarantee ? ` – ${kr(r.guarantee)} kr som eventualförpliktelse` : ''}${r.pledge ? ` – ${kr(r.pledge)} kr spärrade medel som ställd säkerhet` : ''}`);
}
export async function docAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let ready = false;
  await attempt(base(cid), async () => { ready = await svc.toggleDocument(actor, id, form(fd)); });
  done(base(cid), ready ? 'Alla dokument är klara' : 'Dokumentlistan är uppdaterad');
}
export async function feeAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let a = 0;
  await attempt(base(cid), async () => { a = await svc.addFee(actor, id, form(fd)); });
  done(base(cid), `Bankavgiften ${kr(a)} kr är bokförd`);
}
export async function closeAction(cid: number, id: number, status: 'utilized' | 'closed' | 'expired', fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(base(cid), async () => { await svc.close(actor, id, status, form(fd)); });
  done(base(cid), { utilized: 'Utnyttjad – åtagandet har upphört', closed: 'Avslutad – åtagandet har upphört', expired: 'Förfallen – åtagandet har upphört' }[status]);
}
