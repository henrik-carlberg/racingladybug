'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/vehicle-register';

const base = (cid: number) => `/c/${cid}/fordon`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function vehicleAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let r = { id: 0, existed: false };
  await attempt(base(cid), async () => { r = await svc.addVehicle(actor, form(fd)); });
  done(base(cid), r.existed ? 'Fordonets uppgifter är uppdaterade' : 'Fordonet är registrerat');
}
export async function eventAction(cid: number, vehicleId: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let r = { booked: 0, account: null as number | null };
  await attempt(base(cid), async () => { r = await svc.addEvent(actor, vehicleId, form(fd)); });
  done(base(cid), r.account ? `Händelsen är registrerad och ${kr(r.booked)} kr är bokfört på ${r.account}` : 'Händelsen är registrerad');
}
