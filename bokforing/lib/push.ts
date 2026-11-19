// Pushnotiser: typer och kontroll av prenumerationer (rena funktioner)

export const PUSH_KINDS = {
  attest: 'Leverantörsfaktura att attestera',
  paid: 'Kund har betalat',
  deadline: 'Deadline om tre dagar',
  bank: 'Bankkopplingen behöver förnyas',
  mention: 'Någon nämner dig i en kommentar',
  receipt: 'Kvitto saknas för ett kortköp',
} as const;
export type PushKind = keyof typeof PUSH_KINDS;
export const isPushKind = (k: string): k is PushKind => k in PUSH_KINDS;

/** Webbläsarnas pushtjänster. Andra adresser tas inte emot (servern ska inte kunna fås att anropa godtyckliga adresser). */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^[a-z0-9-]+\.push\.apple\.com$/, /^web\.push\.apple\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/];

export function validPushEndpoint(endpoint: string, allowInsecure = false): boolean {
  let u: URL;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.username || u.password || endpoint.length > 1000) return false;
  if (allowInsecure && u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true;
  return u.protocol === 'https:' && !u.port && PUSH_HOSTS.some((r) => r.test(u.hostname));
}

/** Nycklarna från webbläsaren: base64url, p256dh är en okomprimerad P-256-punkt (65 byte), auth 16 byte */
export function validPushKeys(p256dh: string, auth: string): boolean {
  const len = (s: string) => (/^[A-Za-z0-9_-]+={0,2}$/.test(s) ? Buffer.from(s, 'base64url').length : -1);
  return len(p256dh) === 65 && len(auth) === 16;
}
