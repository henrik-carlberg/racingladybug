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
