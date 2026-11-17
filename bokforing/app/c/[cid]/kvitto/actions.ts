'use server';
import { unstable_rethrow } from 'next/navigation';
import { amount, done, fileFrom, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { createReceipt } from '@/lib/services/receipts';

export type ReceiptState = { error?: string } | undefined;

export async function saveReceipt(cid: number, _prev: ReceiptState, fd: FormData): Promise<ReceiptState> {
  const actor = userActor(await requireCompany(cid));
  try {
    await createReceipt(actor, {
      category: str(fd, 'category'), total: amount(fd, 'total', 'Belopp'), vat_rate: str(fd, 'vat_rate'), persons: str(fd, 'persons'),
      paid_with: str(fd, 'paid_with'), date: str(fd, 'date'), description: str(fd, 'description'),
    }, await fileFrom(fd));
  } catch (e) {
    unstable_rethrow(e);
    return { error: e instanceof Error ? e.message : 'Något gick fel' };
  }
  done(`/c/${cid}/kvitto`, fd.get('another') === '1' ? 'Kvittot är bokfört – registrera nästa' : 'Kvittot är bokfört');
}
