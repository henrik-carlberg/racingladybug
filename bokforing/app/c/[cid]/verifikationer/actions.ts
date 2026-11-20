'use server';
import { redirect } from 'next/navigation';
import { unstable_rethrow } from 'next/navigation';
import { attempt, amount, done, fileFrom, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { suggestVoucher } from '@/lib/services/ai-bookkeeping';
import { limit } from '@/lib/server/ratelimit';
import { addAttachment, createManualVoucher, reverse as reverseSvc } from '@/lib/services/vouchers';

export type FormState = { error?: string } | undefined;

export async function saveVoucher(cid: number, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let id = 0;
  try {
    const raw = JSON.parse(str(fd, 'lines') || '[]') as { account: string; debit: string; credit: string; description: string; cc?: string; project?: string }[];
    const lines = raw.filter((r) => r.account || r.debit || r.credit).map((r, i) => ({
      account: r.account, debit: amount(r.debit, undefined, `Rad ${i + 1}: debet`) ?? 0,
      credit: amount(r.credit, undefined, `Rad ${i + 1}: kredit`) ?? 0, description: r.description, cost_center_id: r.cc || undefined, project_id: r.project || undefined,
    }));
    id = (await createManualVoucher(actor, { date: str(fd, 'date'), description: str(fd, 'description'), lines }, await fileFrom(fd))).id;
  } catch (e) {
    unstable_rethrow(e);
    return { error: e instanceof Error ? e.message : 'Något gick fel' };
  }
  done(`/c/${cid}/verifikationer/${id}`, 'Verifikationen är bokförd');
}

export async function reverse(cid: number, vid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  let newId = 0;
  await attempt(`/c/${cid}/verifikationer/${vid}`, async () => {
    newId = (await reverseSvc(actor, vid, { date: str(fd, 'date'), reason: str(fd, 'reason') })).id;
  });
  done(`/c/${cid}/verifikationer/${newId}`, 'Rättelseverifikationen är bokförd');
}

export async function uploadAttachment(cid: number, vid: number, fd: FormData) {
  const actor = userActor(await requireCompany(cid, { perm: 'ledger' }));
  await attempt(`/c/${cid}/verifikationer/${vid}`, async () => {
    const f = await fileFrom(fd);
    if (!f) throw new Error('Välj en fil');
    await addAttachment(actor, vid, f);
  });
  done(`/c/${cid}/verifikationer/${vid}`, 'Underlaget är uppladdat');
}

/** Beskriv med egna ord → AI föreslår en verifikation som öppnas i formuläret */
export async function aiVoucher(cid: number, fd: FormData) {
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  if (!ctx.aiAccess) redirect(`/c/${cid}/verifikationer/ny?error=${encodeURIComponent('Du har inte tillgång till AI-kontering')}`);
  const actor = userActor(ctx);
  let id = 0;
  await attempt(`/c/${cid}/verifikationer/ny`, async () => { await limit(`ai-voucher:${cid}`, 60, 3600); id = await suggestVoucher(actor, str(fd, 'text')); });
  done(`/c/${cid}/verifikationer/ny?ai=${id}`);
}
