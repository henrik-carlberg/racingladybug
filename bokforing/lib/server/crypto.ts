import 'server-only';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * Nyckel för kryptering av hemligheter i databasen (bank-sessioner) och försegling av signerade dokument.
 * Sätt ENCRYPTION_KEY (minst 32 tecken) i produktion. I utveckling används en härledd nyckel.
 */
function key(purpose: string): Buffer {
  const base = process.env.ENCRYPTION_KEY;
  if (!base) {
    if (process.env.NODE_ENV === 'production' && process.env.VERCEL) throw new Error('ENCRYPTION_KEY saknas');
    return createHash('sha256').update(`dev-only-key:${purpose}`).digest();
  }
  if (base.length < 32) throw new Error('ENCRYPTION_KEY måste vara minst 32 tecken');
  return createHash('sha256').update(`${base}:${purpose}`).digest();
}

/** AES-256-GCM. Resultat: base64url(iv | tag | ciphertext) */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key('enc'), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64url');
}

export function decrypt(enc: string): string {
  const b = Buffer.from(enc, 'base64url');
  const d = createDecipheriv('aes-256-gcm', key('enc'), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

/** Försegling (HMAC) av t.ex. signeringsbevis */
export function seal(data: string): string {
  return createHmac('sha256', key('seal')).update(data).digest('hex');
}
