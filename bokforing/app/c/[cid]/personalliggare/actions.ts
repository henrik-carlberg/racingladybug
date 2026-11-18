'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/staff';

const base = (cid: number, qs = '') => `/c/${cid}/personalliggare${qs}`;

export async function createSite(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  await attempt(base(cid), () => svc.createSite(actor, str(fd, 'name'), str(fd, 'address')));
  done(base(cid), 'Arbetsplatsen är tillagd');
}

export async function rotateKiosk(cid: number, id: number) {
  const actor = userActor(await requireCompany(cid));
  await attempt(base(cid), () => svc.newKioskToken(actor, id));
  done(base(cid), 'Stämplingssidan har fått en ny adress');
}

export async function stampFor(cid: number, fd: FormData) {
  const ctx = await requireCompany(cid);
  let msg = '';
  await attempt(base(cid), async () => {
    const r = await svc.stamp(ctx.company.id, Number(str(fd, 'site_id')), { personalNumber: str(fd, 'personal_number'), name: str(fd, 'name') }, 'manager', ctx.user.id);
    msg = `${r.name} är ${r.action === 'in' ? 'instämplad' : 'utstämplad'}`;
  });
  done(base(cid), msg);
}

export async function addEntry(cid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  await attempt(base(cid), () => svc.addEntry(actor, {
    site_id: Number(str(fd, 'site_id')), name: str(fd, 'name'), personal_number: str(fd, 'personal_number'),
    check_in: str(fd, 'check_in'), check_out: str(fd, 'check_out') || undefined, reason: str(fd, 'reason'),
  }));
  done(base(cid), 'Registreringen är tillagd');
}

export async function correct(cid: number, id: number, qs: string, fd: FormData) {
  const actor = userActor(await requireCompany(cid));
  await attempt(base(cid, qs), () => svc.correctEntry(actor, id, { check_in: str(fd, 'check_in') || undefined, check_out: str(fd, 'check_out') || undefined, reason: str(fd, 'reason') }));
  done(base(cid, qs), 'Rättelsen är sparad');
}
