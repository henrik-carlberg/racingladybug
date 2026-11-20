// Företagsinloggning (ren logik): SSO-utfärdare, e-postdomäner, IP-begränsning och tvåstegskrav.
import { isIP } from 'node:net';

export type SsoProvider = 'entra' | 'google' | 'oidc';

/** Utfärdare för leverantören. Entra: katalogens (tenant) id; Google: fast; övriga: angiven https-adress. */
export function issuerFor(provider: SsoProvider, value: string, allowInsecure = false): string {
  if (provider === 'google') return 'https://accounts.google.com';
  if (provider === 'entra') {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim())) throw new Error('Ange katalogens id (Directory/tenant ID) från Entra');
    return `https://login.microsoftonline.com/${value.trim().toLowerCase()}/v2.0`;
  }
  let u: URL;
  try { u = new URL(value.trim()); } catch { throw new Error('Ange utfärdarens adress (issuer)'); }
  if (u.protocol !== 'https:' && !(allowInsecure && u.protocol === 'http:')) throw new Error('Utfärdaren måste använda https');
  if (!allowInsecure && (u.hostname === 'localhost' || isIP(u.hostname) || u.hostname.endsWith('.local') || u.hostname.endsWith('.internal'))) throw new Error('Utfärdaren måste vara en publik adress');
  if (u.search || u.hash || u.username) throw new Error('Utfärdarens adress får inte ha parametrar');
  return u.toString().replace(/\/$/, '');
}

export const domainOf = (email: string) => (email.toLowerCase().split('@')[1] ?? '').trim();

export function parseDomains(text: string): string[] {
  const out = [...new Set(text.toLowerCase().split(/[\s,;]+/).map((d) => d.replace(/^@/, '').trim()).filter(Boolean))];
  for (const d of out) if (!/^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(d)) throw new Error(`Ogiltig domän: ${d}`);
  if (['gmail.com', 'hotmail.com', 'outlook.com', 'live.com', 'yahoo.com', 'icloud.com', 'hotmail.se'].some((d) => out.includes(d))) throw new Error('Publika e-postdomäner kan inte kopplas till företagsinloggning');
  return out;
}

/** E-postadressen ur id_token: verifierad e-post, eller Entras preferred_username/upn */
export function emailFrom(c: Record<string, unknown>, provider: SsoProvider): string | null {
  const email = typeof c.email === 'string' ? c.email : null;
  // Google och Entra utfärdar bara e-post de själva kontrollerar; andra leverantörer måste uttryckligen ange email_verified
  const verified = provider === 'oidc' ? c.email_verified === true || c.email_verified === 'true' : c.email_verified !== false && c.email_verified !== 'false';
  if (email && verified) return email.toLowerCase();
  if (provider === 'entra') {
    const u = typeof c.preferred_username === 'string' ? c.preferred_username : typeof c.upn === 'string' ? c.upn : null;
    if (u && u.includes('@')) return u.toLowerCase();
  }
  return null;
}

/** Google Workspace: domänen ska också finnas i hd-claimet (så att privata Google-konton inte räknas) */
export function domainAllowed(email: string, domains: string[], claims: Record<string, unknown>, provider: SsoProvider) {
  const d = domainOf(email);
  if (!domains.includes(d)) return false;
  if (provider === 'google' && claims.hd !== d) return false;
  return true;
}

/** Har identitetsleverantören gjort tvåstegsverifiering? (amr enligt RFC 8176) */
export const amrHasMfa = (c: Record<string, unknown>) => Array.isArray(c.amr) && c.amr.some((x) => ['mfa', 'otp', 'hwk', 'swk', 'fido', 'sms', 'face', 'fpt'].includes(String(x)));

/** Privat, lokal eller reserverad adress (får inte nås från servern för identitetsleverantörer) */
export function isPrivateIp(ipRaw: string): boolean {
  const ip = ipRaw.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');
  const blocked = isIP(ip) === 4
    ? ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.168.0.0/16', '198.18.0.0/15', '224.0.0.0/4', '240.0.0.0/4']
    : ['::/128', '::1/128', 'fc00::/7', 'fe80::/10', 'ff00::/8', '64:ff9b::/96', '2001:db8::/32'];
  return isIP(ip) === 0 || blocked.some((c) => ipAllowed(ip, [c]));
}

// ---------- IP ----------
function toBig(ip: string): { v: bigint; bits: number } | null {
  const t = isIP(ip);
  if (t === 4) return { v: ip.split('.').reduce((a, p) => (a << 8n) + BigInt(Number(p)), 0n), bits: 32 };
  if (t === 6) {
    let s = ip.toLowerCase();
    const v4 = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
    if (v4) { const b = toBig(v4[2])!.v; s = `${v4[1]}${(b >> 16n).toString(16)}:${(b & 0xffffn).toString(16)}`; }
    const [head, tail] = s.split('::');
    const h = head ? head.split(':') : [], tl = tail !== undefined ? (tail ? tail.split(':') : []) : [];
    const parts = tail !== undefined ? [...h, ...Array(8 - h.length - tl.length).fill('0'), ...tl] : h;
    if (parts.length !== 8) return null;
    return { v: parts.reduce((a, p) => (a << 16n) + BigInt(parseInt(p || '0', 16)), 0n), bits: 128 };
  }
  return null;
}
const unmap = (ip: string) => ip.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');

export function parseCidrs(text: string): string[] {
  const out = [...new Set(text.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean))];
  for (const c of out) {
    const [ip, len] = c.split('/');
    const b = toBig(ip);
    if (!b || (len !== undefined && (!/^\d+$/.test(len) || Number(len) > b.bits || (b.bits === 32 ? Number(len) < 8 : Number(len) < 16)))) throw new Error(`Ogiltig IP-adress eller nätmask: ${c}`);
  }
  return out;
}

export function ipAllowed(ipRaw: string, cidrs: string[]): boolean {
  if (!cidrs.length) return true;
  const ip = toBig(unmap(ipRaw));
  if (!ip) return false;
  return cidrs.some((c) => {
    const [base, len] = c.split('/');
    const b = toBig(unmap(base));
    if (!b || b.bits !== ip.bits) return false;
    const n = BigInt(len === undefined ? b.bits : Number(len));
    const shift = BigInt(b.bits) - n;
    return (ip.v >> shift) === (b.v >> shift);
  });
}

/** Kort beskrivning av enheten ur user-agent */
export function deviceLabel(ua: string | null): string {
  if (!ua) return 'Okänd enhet';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Okänt system';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Webbläsare';
  return `${br} på ${os}`;
}
