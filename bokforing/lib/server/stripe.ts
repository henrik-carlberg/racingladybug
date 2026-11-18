import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stripe via REST (inget SDK). Kräver STRIPE_SECRET_KEY och STRIPE_WEBHOOK_SECRET.
 * STRIPE_API_URL kan pekas om (används i testerna mot en fejkad Stripe).
 */
export const stripeConfigured = () => !!process.env.STRIPE_SECRET_KEY;
const api = () => process.env.STRIPE_API_URL || 'https://api.stripe.com';

/** Stripe-formatkodning: { a: { b: 1 }, c: [ { d: 2 } ] } → a[b]=1&c[0][d]=2 */
export function formEncode(obj: Record<string, unknown>, prefix = ''): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => parts.push(typeof x === 'object' ? formEncode(x as Record<string, unknown>, `${key}[${i}]`) : `${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(x))}`));
    else if (typeof v === 'object') parts.push(formEncode(v as Record<string, unknown>, key));
    else parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return parts.filter(Boolean).join('&');
}

/** Anrop till Stripe. account: anropet görs för ett anslutet konto (Stripe Connect, huvudet Stripe-Account). */
export async function stripe<T = Record<string, unknown>>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: Record<string, unknown>, opts: { account?: string; idempotencyKey?: string } = {}): Promise<T> {
  const res = await fetch(`${api()}/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-06-20',
      ...(opts.account ? { 'Stripe-Account': opts.account } : {}), ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
    },
    body: body ? formEncode(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json()) as T & { error?: { message: string } };
  if (!res.ok) throw new Error(`Stripe: ${json.error?.message ?? res.status}`);
  return json;
}

/** Verifierar Stripe-Signature (t=…,v1=…) med webhook-hemligheten. Tolerans 5 minuter. */
export function verifyStripeSignature(payload: string, header: string | null, secret: string, now = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(now / 1000 - t) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  const sigs = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}
