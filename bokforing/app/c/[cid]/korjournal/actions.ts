'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { kr } from '@/lib/format';
import * as svc from '@/lib/services/vehicle-log';

const base = (cid: number, year?: string | number) => `/c/${cid}/korjournal${year ? `?year=${year}` : ''}`;
const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
const yr = (fd: FormData) => String(fd.get('year') ?? '').replace(/\D/g, '');

export async function vehicleAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(base(cid, yr(fd)), async () => { await svc.addVehicle(actor, form(fd)); });
  done(base(cid, yr(fd)), 'Fordonet är upplagt');
}
export async function tripAction(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let km = 0;
  await attempt(base(cid, yr(fd)), async () => { km = await svc.addTrip(actor, form(fd)); });
  done(base(cid, yr(fd)), `Resan är sparad i körjournalen (${String(km).replace('.', ',')} km)`);
}
export async function settleAction(cid: number, vehicleId: number, year: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let r = { kind: '', amount: 0, km: 0 };
  await attempt(base(cid, year), async () => { r = await svc.settle(actor, vehicleId, year, form(fd)); });
  done(base(cid, year), r.kind === 'private_use' ? `Uttag för privat körning ${kr(r.amount)} kr är bokfört (2013/3990)` : `Avdrag för egen bil i tjänsten ${kr(r.amount)} kr är bokfört (7331/2018)`);
}
