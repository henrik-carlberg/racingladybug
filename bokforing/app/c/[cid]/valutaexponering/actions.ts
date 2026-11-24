'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/fx-exposure';

const base = (cid: number) => `/c/${cid}/valutaexponering`;

export async function settingsAction(cid: number, currency: string, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(base(cid), async () => { await svc.saveSettings(actor, currency, Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'))); });
  done(base(cid), `Kurs och gräns för ${String(currency).toUpperCase()} är sparade`);
}
