import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ValidationError } from '@/lib/errors';

// Kreditupplysningstjänst (t.ex. UC eller Creditsafe via deras API): rapport på organisationsnummer och bevakning
const conf = () => ({ url: (process.env.CREDIT_API_URL || '').replace(/\/$/, ''), key: process.env.CREDIT_API_KEY || '', secret: process.env.CREDIT_WEBHOOK_SECRET || '',
  insecure: process.env.CREDIT_ALLOW_INSECURE === '1' });
export const creditConfigured = () => { const c = conf(); return !!(c.url && c.key) && (c.url.startsWith('https://') || c.insecure); };

async function call(method: string, path: string, body?: unknown) {
  const c = conf();
  if (!creditConfigured()) throw new ValidationError('Kreditupplysning är inte uppsatt');
  const r = await fetch(c.url + path, { method, redirect: 'error', signal: AbortSignal.timeout(15000), headers: { authorization: `Bearer ${c.key}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => null);
  if (!r) throw new ValidationError('Kreditupplysningstjänsten svarar inte');
  const j = await r.json().catch(() => null) as Record<string, unknown> | null;
  if (!r.ok) throw new ValidationError(`Kreditupplysningen: ${(j?.message as string) ?? `HTTP ${r.status}`}`);
  return j ?? {};
}

export interface Report { id: string; orgnr: string; name: string; score: number | null; rating: string; remarks: number; status: string; recommendedLimit: number | null; raw: Record<string, unknown> }
const report = (j: Record<string, unknown>): Report => ({
  id: String(j.id ?? ''), orgnr: String(j.orgnr ?? ''), name: String(j.name ?? ''), score: j.score == null ? null : Number(j.score), rating: String(j.rating ?? ''),
  remarks: Number(j.payment_remarks ?? 0), status: String(j.status ?? 'active'), recommendedLimit: j.recommended_limit == null ? null : Number(j.recommended_limit), raw: j,
});
export const fetchReport = async (orgnr: string) => report(await call('POST', '/reports', { orgnr }));
export const startMonitor = async (orgnr: string, reference: string) => String((await call('POST', '/monitors', { orgnr, reference })).id ?? '');
export const stopMonitor = async (id: string) => { await call('DELETE', `/monitors/${encodeURIComponent(id)}`); };

export function verifyCreditWebhook(body: string, signature: string | null) {
  const s = conf().secret;
  if (!s || !signature) return false;
  const want = Buffer.from(createHmac('sha256', s).update(body).digest('hex'));
  const got = Buffer.from(signature.replace(/^sha256=/, ''));
  return want.length === got.length && timingSafeEqual(want, got);
}
