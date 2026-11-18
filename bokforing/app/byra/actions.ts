'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireUser } from '@/lib/server/auth';
import { requestOrigin } from '@/lib/server/origin';
import * as svc from '@/lib/services/firms';

export async function createFirm(fd: FormData) {
  const user = await requireUser();
  await attempt('/byra', () => svc.createFirm(user.id, str(fd, 'name'), str(fd, 'orgnr')));
  done('/byra', 'Byrån är skapad');
}

export async function invite(firmId: number, fd: FormData) {
  const user = await requireUser();
  let link = '';
  await attempt(`/byra?f=${firmId}`, async () => { link = `${await requestOrigin()}/byra/inbjudan/${await svc.inviteColleague(user.id, firmId, str(fd, 'email'))}`; });
  done(`/byra?f=${firmId}`, `Skicka länken till din kollega: ${link}`);
}

export async function removeMember(firmId: number, memberId: number) {
  const user = await requireUser();
  await attempt(`/byra?f=${firmId}`, () => svc.removeMember(user.id, firmId, memberId));
  done(`/byra?f=${firmId}`, 'Kollegan är borttagen från byrån');
}

export async function rotateCode(firmId: number) {
  const user = await requireUser();
  await attempt(`/byra?f=${firmId}`, () => svc.newFirmCode(user.id, firmId));
  done(`/byra?f=${firmId}`, 'Byrån har fått en ny kod. Klienter som redan har gett åtkomst påverkas inte.');
}

export async function setResponsible(firmId: number, companyId: number, fd: FormData) {
  const user = await requireUser();
  await attempt(`/byra?f=${firmId}`, () => svc.setResponsible(user.id, firmId, companyId, Number(str(fd, 'responsible')) || null));
  done(`/byra?f=${firmId}`);
}

export async function acceptInvite(token: string) {
  const user = await requireUser();
  let firmId = 0;
  await attempt(`/byra/inbjudan/${token}`, async () => { firmId = await svc.acceptFirmInvite(user.id, user.email, token); });
  done(`/byra?f=${firmId}`, 'Välkommen till byrån');
}
