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
