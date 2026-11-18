'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { acceptQuote, updateContact } from '@/lib/services/portal';

const back = (token: string, q: string) => `/k/${token}?${q}`;

export async function accept(token: string, dealId: number, fd: FormData) {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim();
  try { await acceptQuote(token, dealId, String(fd.get('name') ?? ''), ip); } catch (e) {
    redirect(back(token, `fel=${encodeURIComponent((e as Error).message)}`));
  }
  redirect(back(token, `ok=${encodeURIComponent('Tack! Offerten är godkänd.')}`));
}

export async function contact(token: string, fd: FormData) {
  const v = (k: string) => String(fd.get(k) ?? '');
  try { await updateContact(token, { email: v('email'), address: v('address'), postal_code: v('postal_code'), city: v('city') }); } catch (e) {
    redirect(back(token, `fel=${encodeURIComponent((e as Error).message)}`));
  }
  redirect(back(token, `ok=${encodeURIComponent('Dina uppgifter är uppdaterade')}`));
}
