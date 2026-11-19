'use server';
import { redirect } from 'next/navigation';
import { requestOrigin } from '@/lib/server/origin';
import { createInvoiceCheckout } from '@/lib/services/payments';
import { limit, LIMITS } from '@/lib/server/ratelimit';

/** Kunden klickar "Betala nu" på fakturalänken (ingen inloggning – länken är hemlig) */
export async function payInvoice(token: string) {
  let url = '';
  try {
    await limit(`pay:${token}`, LIMITS.publicAction.max, LIMITS.publicAction.window);
    url = await createInvoiceCheckout(token, await requestOrigin());
  } catch (e) {
    console.error('checkout', e);
    redirect(`/f/${token}?betalning=fel`);
  }
  redirect(url);
}

/** Kunden betalar med Swish: med mobilnummer skickas förfrågan till appen, annars öppnas Swish på samma telefon */
export async function swish(token: string, fd: FormData) {
  const { startSwish } = await import('@/lib/services/paid-faster');
  let q = '';
  try {
    await limit(`swish:${token}`, 10, 600);
    const r = await startSwish(token, String(fd.get('phone') ?? '').trim(), await requestOrigin());
    q = `swish=${r.instruction}${r.token ? `&st=${encodeURIComponent(r.token)}` : ''}`;
  } catch (e) {
    q = `swishfel=${encodeURIComponent(e instanceof Error ? e.message : 'Swish-betalningen kunde inte startas')}`;
  }
  redirect(`/f/${token}?${q}`);
}

export async function swishCheck(token: string, instruction: string) {
  const { checkSwish, swishStatusFor } = await import('@/lib/services/paid-faster');
  try {
    await limit(`swishcheck:${token}`, 30, 600);
    if (await swishStatusFor(token, instruction)) await checkSwish(instruction);
  } catch (e) { console.error('swish check', e instanceof Error ? e.message : e); }
  redirect(`/f/${token}?swish=${instruction}`);
}
