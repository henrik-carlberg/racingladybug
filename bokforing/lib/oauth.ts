// OAuth 2 för tredjepartsappar (authorization code + PKCE) – ren logik (testbar).
import { createHash, timingSafeEqual } from 'node:crypto';

/** Återkomstadress: https, eller http bara till den egna datorn (för utveckling). Inga fragment. */
export function validRedirectUri(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
}

/** PKCE S256: base64url(sha256(verifier)) ska vara lika med challenge. Verifieraren 43–128 tecken. */
export function pkceOk(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return false;
  const a = Buffer.from(createHash('sha256').update(verifier).digest('base64url')), b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** "sales:read sales:write" → unika behörigheter, bara kända. Okända ger fel. */
export function parseScopes(raw: string, known: Set<string>): string[] {
  const list = [...new Set(raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
  const bad = list.filter((s) => !known.has(s));
  if (bad.length) throw new Error(`Okända behörigheter: ${bad.join(', ')}`);
  if (!list.length) throw new Error('Appen begär inga behörigheter');
  return list;
}

/** Vilken läsbehörighet som krävs för att få en händelse (via webhook/REST hook) */
const EVENT_SCOPE: [RegExp, string][] = [
  [/^(customer|invoice)\./, 'sales:read'],
  [/^(supplier|supplier_invoice)\./, 'purchasing:read'],
  [/^(employee|payroll_run)\./, 'payroll:read'],
  [/^bank\./, 'bank:read'],
  [/^document\./, 'documents:read'],
  [/^(time_entry|project)\./, 'time:read'],
  [/^(voucher|account|vat)\./, 'accounting:read'],
];
export function eventScope(event: string): string | null {
  for (const [re, s] of EVENT_SCOPE) if (re.test(event)) return s;
  const m = /^([a-z]+)\./.exec(event); // tilläggsmoduler: <modul>.x → <modul>:read
  return m ? `${m[1]}:read` : null;
}
export const canReceive = (event: string, scopes: string[]) => { const s = eventScope(event); return !!s && (scopes.includes(s) || scopes.includes(s.replace(':read', ':write'))); };

export const ACCESS_TTL = 3600, REFRESH_TTL = 60 * 86400, CODE_TTL = 600;
