'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { acceptQuote, portalByToken, updateContact } from '@/lib/services/portal';
import { limit, LIMITS } from '@/lib/server/ratelimit';

const back = (token: string, q: string) => `/k/${token}?${q}`;

export async function accept(token: string, dealId: number, fd: FormData) {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim();
  try { await limit(`portal:${token}`, LIMITS.publicAction.max, LIMITS.publicAction.window); await acceptQuote(token, dealId, String(fd.get('name') ?? ''), ip); } catch (e) {
    redirect(back(token, `fel=${encodeURIComponent((e as Error).message)}`));
  }
  redirect(back(token, `ok=${encodeURIComponent('Tack! Offerten är godkänd.')}`));
}

export async function contact(token: string, fd: FormData) {
  const v = (k: string) => String(fd.get(k) ?? '');
  try { await limit(`portal:${token}`, LIMITS.publicAction.max, LIMITS.publicAction.window); await updateContact(token, { email: v('email'), address: v('address'), postal_code: v('postal_code'), city: v('city') }); } catch (e) {
    redirect(back(token, `fel=${encodeURIComponent((e as Error).message)}`));
  }
  redirect(back(token, `ok=${encodeURIComponent('Dina uppgifter är uppdaterade')}`));
}

/** Kunden väljer att dela upp betalningen av en faktura */
export async function plan(token: string, invoiceId: number, fd: FormData) {
  const { choosePlan } = await import('@/lib/services/paid-faster');
  try {
    await limit(`portal:${token}`, LIMITS.publicAction.max, LIMITS.publicAction.window);
    const p = await portalByToken(token);
    if (!p) throw new Error('Länken är ogiltig');
    await choosePlan(p.company_id, p.customer_id, invoiceId, Number(fd.get('n')));
  } catch (e) {
    redirect(back(token, `fel=${encodeURIComponent((e as Error).message)}`));
  }
  redirect(back(token, `ok=${encodeURIComponent('Tack! Betalningen är uppdelad – du ser delarna på fakturan.')}`));
}
