'use server';
import { redirect } from 'next/navigation';
import { publicBook } from '@/lib/services/bookings';
import { clientIp, limit, LIMITS } from '@/lib/server/ratelimit';

/** Bokning via den publika länken (ingen inloggning – adressen är hemlig) */
export async function publicBookAction(token: string, fd: FormData) {
  const input = Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
  const back = `/boka/${encodeURIComponent(token)}?date=${encodeURIComponent(String(input.date ?? ''))}`;
  let msg = '';
  try {
    await limit(`booking:${token}:${await clientIp()}`, LIMITS.publicAction.max, LIMITS.publicAction.window);
    const r = await publicBook(token, input);
    msg = `Tack! ${r.service} är bokad ${r.date} kl. ${r.time}.`;
  } catch (e) {
    redirect(`${back}&fel=${encodeURIComponent((e as Error).message)}`);
  }
  redirect(`${back}&ok=${encodeURIComponent(msg)}`);
}
