import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ValidationError } from '@/lib/errors';

// Inkassobolagets API: ärenden skapas med fakturans uppgifter, status hämtas tillbaka (webhook + hämtning)
const conf = () => ({ url: (process.env.INKASSO_API_URL || '').replace(/\/$/, ''), key: process.env.INKASSO_API_KEY || '', secret: process.env.INKASSO_WEBHOOK_SECRET || '',
  insecure: process.env.INKASSO_ALLOW_INSECURE === '1' });
export const collectionConfigured = () => { const c = conf(); return !!(c.url && c.key) && (c.url.startsWith('https://') || c.insecure); };

async function call(method: string, path: string, body?: unknown) {
  const c = conf();
  const res = await fetch(c.url + path, { method, redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { authorization: `Bearer ${c.key}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (!res.ok) throw new ValidationError(`Inkassobolaget: ${(json?.message as string) ?? `HTTP ${res.status}`}`);
  return json ?? {};
}

export interface CaseIn {
  reference: string; creditor: { name: string; orgnr: string };
  debtor: { name: string; orgnr: string; email: string; phone: string; address: string; postal_code: string; city: string; country: string };
  invoice: { number: number; date: string; due_date: string; amount: number; remaining: number; currency: string; ocr: string | null }; reminders: { level: number; date: string }[];
}
export async function createCase(c: CaseIn): Promise<{ id: string; status: string }> {
  const r = await call('POST', '/cases', c);
  if (typeof r.id !== 'string') throw new Error('Inkassobolaget svarade utan ärende-id');
  return { id: r.id, status: String(r.status ?? 'registered') };
}
export async function getCase(id: string): Promise<{ status: string; status_text?: string; collected?: number }> {
  return call('GET', `/cases/${encodeURIComponent(id)}`) as never;
}
export async function recallCase(id: string) { await call('POST', `/cases/${encodeURIComponent(id)}/recall`, {}); }

export function verifyCollectionWebhook(body: string, signature: string | null): boolean {
  const s = conf().secret;
  if (!s || !signature) return false;
  const want = Buffer.from(createHmac('sha256', s).update(body).digest('hex'));
  const got = Buffer.from(signature.replace(/^sha256=/, ''));
  return want.length === got.length && timingSafeEqual(want, got);
}
