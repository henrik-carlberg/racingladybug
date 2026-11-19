import 'server-only';
import https from 'node:https';
import http from 'node:http';
import { ValidationError } from '@/lib/errors';

// Swish Handel (betalningsförfrågningar). Swish kräver klientcertifikat (mTLS): SWISH_CERT och SWISH_KEY som base64-kodad PEM.
const conf = () => ({
  url: (process.env.SWISH_API_URL || 'https://cpc.getswish.net/swish-cpcapi').replace(/\/$/, ''),
  cert: process.env.SWISH_CERT ? Buffer.from(process.env.SWISH_CERT, 'base64') : undefined,
  key: process.env.SWISH_KEY ? Buffer.from(process.env.SWISH_KEY, 'base64') : undefined,
  ca: process.env.SWISH_CA ? Buffer.from(process.env.SWISH_CA, 'base64') : undefined,
  insecure: process.env.SWISH_ALLOW_INSECURE === '1',
});
export const swishConfigured = () => { const c = conf(); return !!(c.cert && c.key) || (c.insecure && !!process.env.SWISH_API_URL); };

function call(method: string, path: string, body?: unknown): Promise<{ status: number; headers: http.IncomingHttpHeaders; json: unknown }> {
  const c = conf();
  const u = new URL(c.url + path);
  if (u.protocol !== 'https:' && !c.insecure) throw new ValidationError('Swish måste anropas med https');
  const data = body === undefined ? undefined : JSON.stringify(body);
  const lib = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(u, { method, timeout: 15000, headers: { 'content-type': 'application/json', ...(data ? { 'content-length': Buffer.byteLength(data) } : {}) },
      ...(u.protocol === 'https:' ? { cert: c.cert, key: c.key, ca: c.ca } : {}) }, (res) => {
      let b = ''; res.on('data', (x) => (b += x)); res.on('end', () => {
        let json: unknown = null; try { json = b ? JSON.parse(b) : null; } catch { json = null; }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Swish svarar inte')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

export interface SwishRequest { payeePaymentReference: string; callbackUrl: string; payeeAlias: string; amount: string; currency: 'SEK'; message: string; payerAlias?: string }

/** Skapar en betalningsförfrågan (PUT med vårt eget instruktions-id). Utan betalarens nummer fås en token för att öppna Swish-appen. */
export async function createPaymentRequest(instructionId: string, r: SwishRequest): Promise<{ token: string | null }> {
  const res = await call('PUT', `/api/v2/paymentrequests/${instructionId}`, r);
  if (res.status !== 201) {
    const err = Array.isArray(res.json) ? (res.json as { errorMessage?: string; errorCode?: string }[])[0] : null;
    throw new ValidationError(err?.errorCode === 'BE18' ? 'Numret är inte kopplat till Swish' : `Swish: ${err?.errorMessage ?? `HTTP ${res.status}`}`);
  }
  const t = res.headers['paymentrequesttoken'];
  return { token: typeof t === 'string' ? t : null };
}

export async function getPaymentRequest(instructionId: string): Promise<{ status?: string; amount?: number; paymentReference?: string; payerAlias?: string; datePaid?: string; errorMessage?: string }> {
  const res = await call('GET', `/api/v1/paymentrequests/${instructionId}`);
  if (res.status !== 200) throw new Error(`Swish: HTTP ${res.status}`);
  return res.json as never;
}
