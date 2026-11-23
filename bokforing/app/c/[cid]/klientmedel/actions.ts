'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/client-funds';

const base = (cid: number, client?: number) => `/c/${cid}/klientmedel${client ? `?client=${client}` : ''}`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function settingsAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(base(cid), async () => { await svc.saveSettings(actor, form(fd)); });
  done(base(cid), 'Kontona för klientmedel är sparade');
}
export async function clientAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let id = 0;
  await attempt(base(cid), async () => { id = await svc.addClient(actor, form(fd)); });
  done(base(cid, id), 'Klienten är upplagd');
}
export async function entryAction(cid: number, clientId: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: fd.get('kind') === 'deposit' ? 'ledger' : 'payments' }));
  let r = { kind: '', amount: 0 };
  await attempt(base(cid, clientId), async () => { r = await svc.addEntry(actor, clientId, form(fd)); });
  done(base(cid, clientId), `${{ deposit: 'Insättningen', payout: 'Utbetalningen', fee: 'Arvodet' }[r.kind]} på ${kr(r.amount)} kr är bokförd${r.kind === 'fee' ? ' och fakturan är betald' : ''}`);
}
export async function closeAction(cid: number, clientId: number) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(base(cid, clientId), async () => { await svc.closeClient(actor, clientId); });
  done(base(cid), 'Klienten är avslutad');
}
