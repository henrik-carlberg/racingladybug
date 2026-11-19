'use server';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/wheel';

const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([k, v]) => typeof v === 'string' && !k.startsWith('$')).map(([k, v]) => [k, String(v)]));
const safe = (cid: number, back: string) => (back.startsWith(`/c/${cid}/arshjul`) ? back : `/c/${cid}/arshjul`);

export async function saveActivity(cid: number, back: string, fd: FormData) {
  const a = userActor(await requireCompany(cid));
  await attempt(safe(cid, back), () => svc.saveActivity(a, form(fd)));
  done(safe(cid, back), 'Aktiviteten är sparad i årshjulet');
}
export async function deleteActivity(cid: number, back: string, id: number) {
  const a = userActor(await requireCompany(cid));
  await attempt(safe(cid, back), () => svc.deleteActivity(a, id));
  done(safe(cid, back), 'Aktiviteten är borttagen');
}
export async function toggleItem(cid: number, back: string, key: string, on: boolean) {
  const a = userActor(await requireCompany(cid));
  await attempt(safe(cid, back), () => svc.markItem(a, key, on));
  done(safe(cid, back), on ? 'Markerad som klar' : 'Markerad som inte klar');
}
export async function newCalendarLink(cid: number) {
  const a = userActor(await requireCompany(cid, { allowLocked: true }));
  const token = await svc.calendarToken(a);
  const { redirect } = await import('next/navigation');
  redirect(`/c/${cid}/arshjul?vy=lista&kalender=${token}#kalender`);
}
