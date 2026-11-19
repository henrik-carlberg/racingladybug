// Signatur för webhooks från Peppol-åtkomstpunkten. Ren logik.
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Verifierar webhookens signatur; tidsstämpeln får vara högst 5 minuter gammal */
export function verifyApWebhook(secret: string, h: { timestamp: string | null; signature: string | null }, body: string, now = Date.now()): boolean {
  if (!h.timestamp || !h.signature || !/^\d{9,11}$/.test(h.timestamp)) return false;
  if (Math.abs(now / 1000 - Number(h.timestamp)) > 300) return false;
  const want = createHmac('sha256', secret).update(`${h.timestamp}.${body}`).digest();
  const got = Buffer.from(h.signature.replace(/^sha256=/, ''), 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}
