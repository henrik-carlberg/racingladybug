'use server';
import { redirect } from 'next/navigation';
import { requestOrigin } from '@/lib/server/origin';
import { createInvoiceCheckout } from '@/lib/services/payments';

/** Kunden klickar "Betala nu" på fakturalänken (ingen inloggning – länken är hemlig) */
export async function payInvoice(token: string) {
  let url = '';
  try { url = await createInvoiceCheckout(token, await requestOrigin()); } catch (e) {
    console.error('checkout', e);
    redirect(`/f/${token}?betalning=fel`);
  }
  redirect(url);
}
