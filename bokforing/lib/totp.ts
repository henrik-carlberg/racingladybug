// Engångskoder enligt RFC 6238 (TOTP, HMAC-SHA1, 30 s, 6 siffror) – fungerar med Google Authenticator, Microsoft Authenticator, 1Password m.fl.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Uint8Array): string {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('Ogiltig base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

/** HOTP-kod för en räknare (RFC 4226) */
export function hotp(secret: string, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, '0');
}

export const totp = (secret: string, time = Date.now(), step = 30) => hotp(secret, Math.floor(time / 1000 / step));

/** Period (räknare) som koden gäller för, inom nuvarande 30-sekundersperiod ±1 (klockskillnad), annars null */
export function totpStep(secret: string, code: string, time = Date.now()): number | null {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const counter = Math.floor(time / 1000 / 30);
  for (const d of [-1, 0, 1]) if (timingSafeEqual(Buffer.from(hotp(secret, counter + d)), Buffer.from(c))) return counter + d;
  return null;
}
export const verifyTotp = (secret: string, code: string, time = Date.now()) => totpStep(secret, code, time) !== null;

export function otpauthUri(secret: string, account: string, issuer = 'Bokföring'): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** 10 reservkoder à 10 tecken (xxxxx-xxxxx) */
export function newBackupCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const s = base32Encode(randomBytes(7)).slice(0, 10).toLowerCase();
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}
export const normalizeBackupCode = (s: string) => s.toLowerCase().replace(/[^a-z2-7]/g, '');
