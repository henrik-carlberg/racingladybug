'use server';
import { unstable_rethrow } from 'next/navigation';
import { amount, done, fileFrom, str } from '@/lib/server/action';
import { requireCompany } from '@/lib/server/auth';
import { userActor } from '@/lib/services/actor';
import { createReceipt } from '@/lib/services/receipts';
import { cardLedger, linkReceipt } from '@/lib/services/cards';

export type ReceiptState = { error?: string } | undefined;

export async function saveReceipt(cid: number, _prev: ReceiptState, fd: FormData): Promise<ReceiptState> {
  const actor = userActor(await requireCompany(cid));
  const txId = Number(str(fd, 'tx')) || 0;
  let linked = false;
  try {
    // Kvitto för ett kortköp: bokförs mot kortets konto och kopplas till köpet
    const card = txId ? await cardLedger(actor.companyId, txId) : null;
    if (txId && !card) throw new Error('Kortköpet finns inte eller har redan ett kvitto');
    const v = await createReceipt(actor, {
      category: str(fd, 'category'), total: amount(fd, 'total', 'Belopp'), vat_rate: str(fd, 'vat_rate'), persons: str(fd, 'persons'),
      paid_with: card ? 'company' : str(fd, 'paid_with'), date: str(fd, 'date'), description: str(fd, 'description'), pay_account: card?.ledger_account,
    }, await fileFrom(fd));
    if (card) linked = !!(await linkReceipt(actor, txId, v.id).catch(() => null));
  } catch (e) {
    unstable_rethrow(e);
    return { error: e instanceof Error ? e.message : 'Något gick fel' };
  }
  if (txId) done(`/c/${cid}/kort`, linked ? 'Kvittot är bokfört och kopplat till kortköpet' : 'Kvittot är bokfört men beloppet stämmer inte med kortköpet – koppla det under Bank');
  done(`/c/${cid}/kvitto`, fd.get('another') === '1' ? 'Kvittot är bokfört – registrera nästa' : 'Kvittot är bokfört');
}

export type ReadState = { guess?: import('@/lib/receipts').ReceiptGuess; error?: string };

/** Läser av kvittobilden med Claude och föreslår fälten (sparar ingenting) */
export async function readReceipt(cid: number, fd: FormData): Promise<ReadState> {
  const { company } = await requireCompany(cid);
  const { extractReceipt, invoiceAiEnabled, ExtractionError } = await import('@/lib/services/invoice-ai');
  const { limit } = await import('@/lib/server/ratelimit');
  if (!invoiceAiEnabled()) return { error: 'Automatisk avläsning är inte påslagen' };
  try {
    const file = await fileFrom(fd);
    if (!file) return { error: 'Välj en bild eller PDF' };
    if (file.data.length > 10 * 1024 * 1024) return { error: 'Filen är för stor för avläsning (max 10 MB)' };
    if (!/^(image\/(jpeg|png|webp|gif)|application\/pdf)$/.test(file.mimeType)) return { error: 'Avläsning fungerar för JPEG, PNG, WebP, GIF och PDF' };
    await limit(`receipt-ai:${company.id}`, 60, 3600);
    return { guess: await extractReceipt(file) };
  } catch (e) {
    unstable_rethrow(e);
    return { error: e instanceof ExtractionError || (e instanceof Error && e.name === 'RateLimitError') ? e.message : e instanceof Error && e.message.startsWith('För många') ? e.message : 'Kvittot kunde inte läsas av' };
  }
}
