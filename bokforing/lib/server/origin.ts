import 'server-only';
import { headers } from 'next/headers';

/** Appens bas-URL (APP_ORIGIN eller härledd från förfrågan) */
export async function requestOrigin(): Promise<string> {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function clientInfo(): Promise<{ ip: string | null; ua: string | null }> {
  const h = await headers();
  return { ip: (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || null, ua: h.get('user-agent') };
}
