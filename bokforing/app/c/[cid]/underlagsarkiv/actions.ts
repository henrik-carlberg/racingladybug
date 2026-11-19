'use server';
import { attempt, done, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { addTag, archiveYear, removeTag, unarchiveYear, verifyYear } from '@/lib/services/doc-archive';

const back = (cid: number, fy?: number) => `/c/${cid}/underlagsarkiv${fy ? `?ar=${fy}` : ''}`;

export async function tag(cid: number, fy: number, attachmentId: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid, fy), () => addTag(actor, attachmentId, str(fd, 'tag')));
  done(back(cid, fy), 'Taggen är tillagd');
}
export async function untag(cid: number, fy: number, attachmentId: number, t: string) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(back(cid, fy), () => removeTag(actor, attachmentId, t));
  done(back(cid, fy), 'Taggen är borttagen');
}
export async function archive(cid: number, fy: number) {
  const actor = userActor(await requireCompany(cid, { owner: true, perm: 'ledger' }));
  let n = { vouchers: 0, files: 0 };
  await attempt(back(cid, fy), async () => { n = await archiveYear(actor, fy); });
  done(back(cid, fy), `Året är arkiverat och förseglat (${n.vouchers} verifikationer, ${n.files} underlag)`);
}
export async function verify(cid: number, fy: number) {
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  let ok = false;
  await attempt(back(cid, fy), async () => { ok = (await verifyYear(company.id, fy)).ok; });
  if (!ok) { const { redirect } = await import('next/navigation'); redirect(`${back(cid, fy)}&error=${encodeURIComponent('Kontrollsumman stämmer inte – något har ändrats sedan året arkiverades')}`); }
  done(back(cid, fy), 'Kontrollsumman stämmer – inget har ändrats sedan året arkiverades');
}
export async function unarchive(cid: number, fy: number) {
  const actor = userActor(await requireCompany(cid, { owner: true, perm: 'ledger' }));
  await attempt(back(cid, fy), () => unarchiveYear(actor, fy));
  done(back(cid, fy), 'Året är inte längre arkiverat');
}
