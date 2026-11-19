import 'server-only';
import { ValidationError } from '@/lib/errors';

// Kivras API för avsändare (företag som skickar till privatpersoners och företags digitala brevlådor).
// Adresser och fält samlade här för att kunna anpassas till Kivras avtal och version.
const conf = () => ({ url: (process.env.KIVRA_API_URL || 'https://sender.api.kivra.com').replace(/\/$/, ''), id: process.env.KIVRA_CLIENT_ID || '',
  secret: process.env.KIVRA_CLIENT_SECRET || '', tenant: process.env.KIVRA_TENANT_KEY || '', insecure: process.env.KIVRA_ALLOW_INSECURE === '1' });
export const kivraConfigured = () => { const c = conf(); return !!(c.id && c.secret && c.tenant) && (c.url.startsWith('https://') || c.insecure); };

let cached: { token: string; until: number } | null = null;
async function token() {
  if (cached && cached.until > Date.now() + 30_000) return cached.token;
  const c = conf();
  const r = await fetch(`${c.url}/v1/auth`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { authorization: `Basic ${Buffer.from(`${c.id}:${c.secret}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  if (!r.ok) throw new Error(`Kivra: inloggning misslyckades (${r.status})`);
  const j = await r.json() as { access_token: string; expires_in?: number };
  cached = { token: j.access_token, until: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return j.access_token;
}

async function call(method: string, path: string, body?: unknown) {
  const c = conf();
  const r = await fetch(`${c.url}/v1/tenant/${encodeURIComponent(c.tenant)}${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json', accept: 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => null) as Record<string, unknown> | null;
  if (!r.ok) throw new ValidationError(`Kivra: ${(j?.long_message ?? j?.message ?? `HTTP ${r.status}`) as string}`);
  return j ?? {};
}

/** Har mottagaren Kivra? (personnummer eller organisationsnummer som momsregistreringsnummer) */
const matchCache = new Map<string, { v: boolean; until: number }>();
export async function hasKivra(r: { type: 'person'; ssn: string } | { type: 'company'; vat: string }): Promise<boolean> {
  // Svaret sparas en timme så att fakturasidan inte frågar Kivra vid varje visning
  const ck = r.type === 'person' ? r.ssn : r.vat;
  const hit = matchCache.get(ck);
  if (hit && hit.until > Date.now()) return hit.v;
  const v = await matchRaw(r);
  matchCache.set(ck, { v, until: Date.now() + 3600_000 });
  if (matchCache.size > 5000) matchCache.clear();
  return v;
}
async function matchRaw(r: { type: 'person'; ssn: string } | { type: 'company'; vat: string }): Promise<boolean> {
  const j = r.type === 'person' ? await call('POST', '/usermatch/ssn', { list: [r.ssn] }) : await call('POST', '/usermatch/vatnumber', { list: [r.vat] });
  return Array.isArray(j.list) && (j.list as string[]).includes(r.type === 'person' ? r.ssn : r.vat);
}

export interface KivraContent {
  to: { type: 'person'; ssn: string } | { type: 'company'; vat: string }; subject: string; type: 'invoice' | 'salary' | 'letter';
  payment?: { amount: number; dueDate: string; ocr: string | null; bankgiro: string }; pdf: Buffer; filename: string;
}
export async function sendContent(c: KivraContent): Promise<string> {
  const j = await call('POST', '/content', {
    ...(c.to.type === 'person' ? { ssn: c.to.ssn } : { vat_number: c.to.vat }), subject: c.subject.slice(0, 100), type: c.type, generated_at: new Date().toISOString().slice(0, 10),
    ...(c.payment ? { payment: { payable: true, currency: 'SEK', due_date: c.payment.dueDate, total_owed: (c.payment.amount / 100).toFixed(2), type: c.payment.ocr ? 'SE_OCR' : 'TENANT_REF',
      reference: c.payment.ocr ?? '', method: 'BG', account: c.payment.bankgiro.replace(/\D/g, '') } } : {}),
    files: [{ name: c.filename, data: c.pdf.toString('base64'), content_type: 'application/pdf' }],
  });
  if (typeof j.key !== 'string') throw new Error('Kivra svarade utan nyckel');
  return j.key;
}

export async function contentStatus(key: string): Promise<string> {
  return String((await call('GET', `/content/${encodeURIComponent(key)}/status`)).status ?? '');
}
