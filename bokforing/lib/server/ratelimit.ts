import 'server-only';
import { headers } from 'next/headers';
import { sql } from '@/lib/db';

/** Fönster i sekunder → början av nuvarande fönster */
const windowStart = (sec: number) => new Date(Math.floor(Date.now() / 1000 / sec) * sec * 1000);
const scale = () => Math.max(1, Number(process.env.RATE_LIMIT_SCALE || 1));

/** Räknar ett anrop. ok = false när gränsen är nådd i nuvarande fönster. */
export async function hit(key: string, limit: number, windowSec: number): Promise<{ ok: boolean; count: number; retryAfter: number }> {
  const start = windowStart(windowSec);
  const [r] = await sql<{ count: number }[]>`
    INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, ${start}, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1 RETURNING count`;
  const retryAfter = Math.max(1, Math.ceil((start.getTime() + windowSec * 1000 - Date.now()) / 1000));
  return { ok: r.count <= limit * scale(), count: r.count, retryAfter };
}

/** Antal anrop i nuvarande fönster utan att räkna upp */
export async function current(key: string, windowSec: number): Promise<number> {
  const [r] = await sql<{ count: number }[]>`SELECT count FROM rate_limits WHERE key = ${key} AND window_start = ${windowStart(windowSec)}`;
  return r?.count ?? 0;
}

export async function clear(key: string) {
  await sql`DELETE FROM rate_limits WHERE key = ${key}`;
}

/** Gallring av gamla fönster (dagligt jobb) */
export async function cleanupRateLimits() {
  const r = await sql`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`;
  return r.count;
}

/** Klientens IP-adress (Vercel sätter x-forwarded-for) */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? '').split(',')[0].trim() || 'okänd';
}

export class RateLimitError extends Error {
  constructor(public retryAfter: number) {
    super(`För många försök. Vänta ${retryAfter > 90 ? `${Math.ceil(retryAfter / 60)} minuter` : `${retryAfter} sekunder`} och försök igen.`);
  }
}

/** Kastar RateLimitError när gränsen är nådd */
export async function limit(key: string, max: number, windowSec: number) {
  const r = await hit(key, max, windowSec);
  if (!r.ok) throw new RateLimitError(r.retryAfter);
}

/** Gränser (per fönster). Kan skalas upp med RATE_LIMIT_SCALE, t.ex. i test. */
export const LIMITS = {
  loginFailEmail: { max: 10, window: 900 },   // 10 misslyckade inloggningar per konto och 15 min
  loginFailIp: { max: 50, window: 900 },
  register: { max: 10, window: 3600 },       // 10 nya konton per IP och timme
  mfa: { max: 10, window: 900 },
  api: { max: 600, window: 60 },             // 600 anrop per API-nyckel och minut
  publicAction: { max: 30, window: 600 },     // betalning, offertgodkännande m.m. per länk
  kiosk: { max: 120, window: 60 },
  passwordChange: { max: 10, window: 900 },
} as const;
