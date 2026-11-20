'use server';
import { redirect } from 'next/navigation';
import { requireCompany, requireUser } from '@/lib/server/auth';
import { parseAmount } from '@/lib/money';
import { saveGroupLink } from '@/lib/services/consolidation';
import { AppError } from '@/lib/errors';

export async function saveLink(back: string, parentId: number, subId: number, fd: FormData) {
  const user = await requireUser();
  // Bokföringsbehörighet i båda bolagen (begränsade användare och revisorer stoppas)
  await requireCompany(parentId, { perm: 'ledger' });
  await requireCompany(subId, { perm: 'ledger' });
  const safe = back.startsWith('/koncern') ? back : '/koncern';
  const money = (k: string) => { const v = String(fd.get(k) ?? '').trim(); return v ? parseAmount(v) : null; };
  let msg = 'ok=' + encodeURIComponent('Koncernuppgifterna är sparade');
  try {
    const int = (k: string, d: number) => { const v = String(fd.get(k) ?? '').trim(); return v ? Number(v) : d; };
    const date = String(fd.get('acquired_on') ?? '').trim();
    await saveGroupLink(user.id, parentId, subId, {
      ownership: Number(String(fd.get('ownership') ?? '100').replace(',', '.')), acquisitionCost: money('acquisition_cost'), acquiredEquity: money('acquired_equity'), remove: fd.get('remove') === '1',
      acquiredOn: date || null, goodwillYears: int('goodwill_years', 5), surplus: money('surplus') ?? 0, surplusYears: int('surplus_years', 10),
      intraInventory: money('intra_inventory') ?? 0, intraInventoryOpening: money('intra_inventory_opening') ?? 0, intraMargin: Number(String(fd.get('intra_margin') ?? '0').replace(',', '.') || 0),
    });
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    msg = 'error=' + encodeURIComponent(e.message);
  }
  redirect(safe + (safe.includes('?') ? '&' : '?') + msg);
}
