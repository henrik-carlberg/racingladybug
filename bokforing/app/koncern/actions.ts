'use server';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/server/auth';
import { parseAmount } from '@/lib/money';
import { saveGroupLink } from '@/lib/services/consolidation';
import { AppError } from '@/lib/errors';

export async function saveLink(back: string, parentId: number, subId: number, fd: FormData) {
  const user = await requireUser();
  const safe = back.startsWith('/koncern') ? back : '/koncern';
  const money = (k: string) => { const v = String(fd.get(k) ?? '').trim(); return v ? parseAmount(v) : null; };
  let msg = 'ok=' + encodeURIComponent('Koncernuppgifterna är sparade');
  try {
    await saveGroupLink(user.id, parentId, subId, { ownership: Number(String(fd.get('ownership') ?? '100').replace(',', '.')), acquisitionCost: money('acquisition_cost'), acquiredEquity: money('acquired_equity'), remove: fd.get('remove') === '1' });
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    msg = 'error=' + encodeURIComponent(e.message);
  }
  redirect(safe + (safe.includes('?') ? '&' : '?') + msg);
}
