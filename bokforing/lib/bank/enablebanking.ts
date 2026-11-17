import 'server-only';
import { createPrivateKey, sign, type KeyObject } from 'node:crypto';
import type { EbTransaction } from './parse';

// Enable Banking (https://enablebanking.com) – Open Banking/PSD2-aggregator med stöd för svenska banker.
// Konfiguration: ENABLEBANKING_APP_ID och ENABLEBANKING_PRIVATE_KEY (PEM, eller base64 av PEM).

export class BankProviderError extends Error {
  constructor(message: string, public status?: number, public code?: string) { super(message); }
}

export function enableBankingConfigured(): boolean {
  return !!(process.env.ENABLEBANKING_APP_ID && process.env.ENABLEBANKING_PRIVATE_KEY);
}

let cachedKey: KeyObject | null = null;
function privateKey(): KeyObject {
  if (cachedKey) return cachedKey;
  let pem = process.env.ENABLEBANKING_PRIVATE_KEY ?? '';
  if (!pem.includes('BEGIN')) pem = Buffer.from(pem, 'base64').toString('utf8');
  cachedKey = createPrivateKey(pem.replace(/\\n/g, '\n'));
  return cachedKey;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** JWT enligt Enable Banking: RS256, kid = applikations-id, max 24 h giltighet */
export function makeJwt(now = Math.floor(Date.now() / 1000)): string {
  const header = { typ: 'JWT', alg: 'RS256', kid: process.env.ENABLEBANKING_APP_ID };
  const payload = { iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 3600 };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  return `${data}.${b64url(sign('RSA-SHA256', Buffer.from(data), privateKey()))}`;
}

const base = () => (process.env.ENABLEBANKING_API_URL ?? 'https://api.enablebanking.com').replace(/\/$/, '');

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!enableBankingConfigured()) throw new BankProviderError('Bankkopplingen är inte konfigurerad (ENABLEBANKING_APP_ID/ENABLEBANKING_PRIVATE_KEY saknas)');
  const res = await fetch(base() + path, {
    method,
    headers: { Authorization: `Bearer ${makeJwt()}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
    cache: 'no-store',
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* inte JSON */ }
  if (!res.ok) {
    const code = typeof json.error === 'string' ? json.error : undefined;
    const msg = (json.message as string) || (json.detail as string) || text.slice(0, 200) || `HTTP ${res.status}`;
    throw new BankProviderError(`Banken/leverantören svarade: ${msg}`, res.status, code);
  }
  return json as T;
}

export interface Aspsp { name: string; country: string; logo?: string; psu_types?: string[]; maximum_consent_validity?: number; beta?: boolean }

export async function listAspsps(country = 'SE'): Promise<Aspsp[]> {
  const r = await call<{ aspsps: Aspsp[] }>('GET', `/aspsps?country=${encodeURIComponent(country)}&service=AIS`);
  return r.aspsps;
}

export async function startAuthorization(o: { aspspName: string; country: string; state: string; redirectUrl: string; validUntil: Date; psuType: 'business' | 'personal' }) {
  return call<{ url: string; authorization_id: string }>('POST', '/auth', {
    access: { valid_until: o.validUntil.toISOString(), balances: true, transactions: true },
    aspsp: { name: o.aspspName, country: o.country },
    state: o.state,
    redirect_url: o.redirectUrl,
    psu_type: o.psuType,
    language: 'sv',
  });
}

export interface EbAccount {
  uid?: string;
  account_id?: { iban?: string; other?: { identification?: string } };
  name?: string;
  details?: string;
  product?: string;
  currency: string;
  cash_account_type?: string;
}

export async function createSession(code: string) {
  return call<{ session_id: string; accounts: EbAccount[]; access: { valid_until: string }; aspsp: { name: string; country: string } }>('POST', '/sessions', { code });
}

export async function deleteSession(sessionId: string) {
  return call<{ message: string }>('DELETE', `/sessions/${encodeURIComponent(sessionId)}`);
}

/** Hämtar alla transaktioner sedan dateFrom (följer continuation_key) */
export async function fetchTransactions(accountUid: string, dateFrom: string): Promise<EbTransaction[]> {
  const out: EbTransaction[] = [];
  let key: string | null = null;
  for (let page = 0; page < 200; page++) {
    const q = new URLSearchParams({ date_from: dateFrom });
    if (key) q.set('continuation_key', key);
    const r: { transactions: EbTransaction[]; continuation_key?: string | null } = await call('GET', `/accounts/${encodeURIComponent(accountUid)}/transactions?${q}`);
    out.push(...r.transactions);
    key = r.continuation_key ?? null;
    if (!key) break;
  }
  return out;
}

export async function fetchBalance(accountUid: string): Promise<{ amount: string; currency: string; date: string | null } | null> {
  const r = await call<{ balances: { name: string; balance_type: string; balance_amount: { amount: string; currency: string }; reference_date?: string }[] }>(
    'GET', `/accounts/${encodeURIComponent(accountUid)}/balances`);
  // Föredra bokfört saldo (CLBD), annars disponibelt (CLAV/ITAV) eller första
  const pick = ['CLBD', 'ITBD', 'CLAV', 'ITAV', 'XPCD'].map((t) => r.balances.find((b) => b.balance_type === t)).find(Boolean) ?? r.balances[0];
  return pick ? { ...pick.balance_amount, date: pick.reference_date ?? null } : null;
}
