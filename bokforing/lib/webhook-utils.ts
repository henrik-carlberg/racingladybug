import { createHmac, timingSafeEqual } from 'node:crypto';
import net from 'node:net';

/** Signatur-header: t=<unix-tid>,v1=<hex(HMAC-SHA256(secret, "<t>.<body>"))> */
export function signPayload(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${mac}`;
}

/** Verifierar en signatur (för mottagare). toleranceSec skyddar mot återuppspelning. */
export function verifySignature(secret: string, body: string, header: string, toleranceSec = 300, now = Date.now()): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!t || !parts.v1 || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest();
  const given = Buffer.from(parts.v1, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Väntetid i minuter före nästa försök, efter `attempts` misslyckade försök. null = ge upp. */
export function backoffMinutes(attempts: number): number | null {
  const schedule = [1, 5, 30, 120, 360, 720, 1440];
  return attempts <= schedule.length ? schedule[attempts - 1] : null;
}
export const MAX_ATTEMPTS = 8;

/** Sant om IP-adressen är publik (inte loopback, privat, länklokal, multicast m.m.) – skydd mot SSRF */
export function isPublicIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    return true;
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    if (s === '::1' || s === '::') return false;
    if (s.startsWith('::ffff:')) return isPublicIp(s.slice(7));
    if (/^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith('ff')) return false;
    return true;
  }
  return false;
}
