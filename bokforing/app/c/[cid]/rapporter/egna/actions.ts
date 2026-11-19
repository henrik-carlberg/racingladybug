'use server';
import { redirect } from 'next/navigation';
import { attempt, done } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import * as svc from '@/lib/services/custom-reports';

const form = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([k, v]) => typeof v === 'string' && !k.startsWith('$')).map(([k, v]) => [k, String(v)]));

export async function createFromTemplate(cid: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const t = svc.TEMPLATES[String(fd.get('template'))] ?? svc.TEMPLATES.kort;
  let id = 0;
  await attempt(`/c/${cid}/rapporter/egna`, async () => { id = await svc.saveReport(a, null, String(fd.get('name') || '') || t.name, t.def); });
  redirect(`/c/${cid}/rapporter/egna/${id}?ok=${encodeURIComponent('Rapporten är skapad – anpassa raderna nedan')}`);
}
export async function save(cid: number, id: number, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const f = form(fd);
  await attempt(`/c/${cid}/rapporter/egna/${id}`, () => svc.saveReport(a, id, f.name ?? '', svc.defFromForm(f)));
  done(`/c/${cid}/rapporter/egna/${id}`, 'Rapporten är sparad');
}
export async function remove(cid: number, id: number) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(`/c/${cid}/rapporter/egna/${id}`, () => svc.deleteReport(a, id));
  done(`/c/${cid}/rapporter/egna`, 'Rapporten är borttagen');
}
export async function share(cid: number, back: string, kind: 'report' | 'kpi', reportId: number | null, fd: FormData) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const safe = back.startsWith(`/c/${cid}/`) ? back.split('?')[0] : `/c/${cid}/nyckeltal`;
  let token = '';
  await attempt(safe, async () => { token = await svc.createShare(a, { kind, reportId: reportId ?? undefined, role: String(fd.get('role') || '') || undefined, days: Number(fd.get('days')), label: String(fd.get('label') ?? '') }); });
  redirect(`${safe}?delad=${token}#dela`);
}
export async function revoke(cid: number, back: string, id: number) {
  const a = userActor(await requireCompany(cid, { perm: 'ledger' }));
  const safe = back.startsWith(`/c/${cid}/`) ? back.split('?')[0] : `/c/${cid}/nyckeltal`;
  await attempt(safe, () => svc.revokeShare(a, id));
  done(safe, 'Länken slutar gälla nu');
}
