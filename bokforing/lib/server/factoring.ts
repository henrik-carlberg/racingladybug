import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ValidationError } from '@/lib/errors';

// Finansiärens API för fakturaköp (factoring): erbjudande, accept och status
const conf = () => ({ url: (process.env.FACTORING_API_URL || '').replace(/\/$/, ''), key: process.env.FACTORING_API_KEY || '', secret: process.env.FACTORING_WEBHOOK_SECRET || '',
  insecure: process.env.FACTORING_ALLOW_INSECURE === '1' });
export const factoringConfigured = () => { const c = conf(); return !!(c.url && c.key) && (c.url.startsWith('https://') || c.insecure); };

async function call(method: string, path: string, body?: unknown) {
  const c = conf();
  const r = await fetch(c.url + path, { method, redirect: 'error', signal: AbortSignal.timeout(15000), headers: { authorization: `Bearer ${c.key}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => null) as Record<string, unknown> | null;
  if (!r.ok) throw new ValidationError(`Finansiären: ${(j?.message as string) ?? `HTTP ${r.status}`}`);
  return j ?? {};
}

export interface Offer { id: string; status: string; advance?: number; fee?: number; message?: string }
const offer = (j: Record<string, unknown>): Offer => ({ id: String(j.id ?? ''), status: String(j.status ?? ''), advance: j.advance == null ? undefined : Number(j.advance), fee: j.fee == null ? undefined : Number(j.fee), message: j.message ? String(j.message) : undefined });

export async function requestOffer(o: { reference: string; invoice: { number: number; amount: number; due_date: string; ocr: string | null; currency: string }; debtor: { name: string; orgnr: string }; seller: { name: string; orgnr: string } }) {
  const j = await call('POST', '/offers', o);
  if (!j.id) throw new Error('Finansiären svarade utan erbjudande');
  return offer(j);
}
export const acceptOffer = async (id: string) => offer(await call('POST', `/offers/${encodeURIComponent(id)}/accept`, {}));
export const getOffer = async (id: string) => offer(await call('GET', `/offers/${encodeURIComponent(id)}`));

export function verifyFactoringWebhook(body: string, signature: string | null) {
  const s = conf().secret;
  if (!s || !signature) return false;
  const want = Buffer.from(createHmac('sha256', s).update(body).digest('hex'));
  const got = Buffer.from(signature.replace(/^sha256=/, ''));
  return want.length === got.length && timingSafeEqual(want, got);
}
