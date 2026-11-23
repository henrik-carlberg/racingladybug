'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/tenders';

const base = (cid: number) => `/c/${cid}/anbud`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function tenderAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(base(cid), async () => { await svc.addTender(actor, form(fd)); });
  done(base(cid), 'Anbudet är registrerat');
}
export async function statusAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(base(cid), async () => { await svc.setStatus(actor, id, form(fd)); });
  done(base(cid), 'Anbudets status är uppdaterad');
}
export async function agreementAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(base(cid), async () => { await svc.addAgreement(actor, form(fd)); });
  done(base(cid), 'Ramavtalet är upplagt');
}
export async function attachAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  let r = { pct: 0, level: 'ok' as string };
  await attempt(base(cid), async () => { r = await svc.attach(actor, id, form(fd)); });
  done(base(cid), `Fakturan är kopplad – ${r.pct.toLocaleString('sv-SE')} % av taket är avropat${r.level === 'over' ? '. Taket är nått' : r.level === 'warn' ? '. Varningsgränsen är passerad' : ''}`);
}
export async function extendAction(cid: number, id: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'invoicing' }));
  await attempt(base(cid), async () => { await svc.extend(actor, id, form(fd)); });
  done(base(cid), 'Avtalet är förlängt');
}
