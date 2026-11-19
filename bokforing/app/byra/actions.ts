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

// ---------- Månadsbokslut och byråns tid ----------
const closeBase = (f: number, p: string) => `/byra/manad?f=${f}&period=${p}`;
export async function markClose(firmId: number, companyId: number, period: string, isDone: boolean) {
  const user = await requireUser();
  const { markDone } = await import('@/lib/services/firm-close');
  await attempt(closeBase(firmId, period), () => markDone(user.id, firmId, companyId, period, isDone));
  done(closeBase(firmId, period), isDone ? 'Månaden är markerad som klar' : 'Markeringen är borttagen');
}
export async function remind(firmId: number, companyId: number, period: string) {
  const user = await requireUser();
  const { remindClient } = await import('@/lib/services/firm-close');
  let r = { sent: 0, items: 0 };
  await attempt(closeBase(firmId, period), async () => { r = await remindClient(user.id, firmId, companyId, period, await requestOrigin()); });
  done(closeBase(firmId, period), r.sent ? `Påminnelse om ${r.items} saker skickad till kunden` : `Påminnelsen (${r.items} saker) är registrerad – e-post är inte uppsatt, så kunden ser den under Frågor och svar`);
}
const timeBase = (f: number, p: string) => `/byra/tid?f=${f}&period=${p}`;
export async function addFirmTime(firmId: number, period: string, fd: FormData) {
  const user = await requireUser();
  const { addTime } = await import('@/lib/services/firm-close');
  const [h, m] = str(fd, 'time').replace(',', '.').split(':');
  const minutes = m !== undefined ? Number(h) * 60 + Number(m) : Math.round(Number(h) * 60);
  await attempt(timeBase(firmId, period), () => addTime(user.id, firmId, { company_id: Number(str(fd, 'company_id')), date: str(fd, 'date'), minutes, description: str(fd, 'description') }));
  done(timeBase(firmId, period), 'Tiden är registrerad');
}
export async function saveBilling(firmId: number, period: string, fd: FormData) {
  const user = await requireUser();
  const { setFirmBilling } = await import('@/lib/services/firm-close');
  const rates: Record<number, number | null> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith('rate_')) { const n = Number(String(v).replace(/\s/g, '').replace(',', '.')); rates[Number(k.slice(5))] = String(v).trim() && n > 0 ? Math.round(n * 100) : null; }
  await attempt(timeBase(firmId, period), () => setFirmBilling(user.id, firmId, { own_company_id: Number(str(fd, 'own_company_id')) || null, rates }));
  done(timeBase(firmId, period), 'Faktureringsinställningarna är sparade');
}
export async function invoiceFirmTime(firmId: number, companyId: number, period: string) {
  const user = await requireUser();
  const { invoiceTime } = await import('@/lib/services/firm-close');
  let r = { invoiceId: 0, companyId: 0, minutes: 0 };
  await attempt(timeBase(firmId, period), async () => { r = await invoiceTime(user.id, firmId, companyId, period); });
  done(`/c/${r.companyId}/fakturor/${r.invoiceId}`, `Fakturautkast för ${Math.round(r.minutes / 6) / 10} timmar är skapat`);
}
