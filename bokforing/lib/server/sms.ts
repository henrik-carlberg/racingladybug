import 'server-only';

// SMS via 46elks-kompatibelt API (POST /a1/sms med formulär och Basic-autentisering)
const conf = () => ({ url: (process.env.SMS_API_URL || 'https://api.46elks.com/a1/sms'), user: process.env.SMS_API_USER || '', pass: process.env.SMS_API_PASSWORD || '', from: process.env.SMS_FROM || 'Faktura' });
export const smsConfigured = () => { const c = conf(); return !!(c.user && c.pass) && (c.url.startsWith('https://') || process.env.SMS_ALLOW_INSECURE === '1'); };

export async function sendSms(to: string, message: string): Promise<boolean> {
  if (!smsConfigured()) return false;
  const c = conf();
  try {
    const res = await fetch(c.url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { authorization: `Basic ${Buffer.from(`${c.user}:${c.pass}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ from: c.from.slice(0, 11), to, message: message.slice(0, 480) }) });
    return res.ok;
  } catch (e) { console.error('sms', e instanceof Error ? e.message : e); return false; }
}
