import 'server-only';

/**
 * E-postutskick via Resend (https://resend.com) om RESEND_API_KEY och MAIL_FROM är satta.
 * Utan konfiguration skickas inget – länkar visas då i appen för att kopieras och skickas manuellt.
 */
export const mailConfigured = () => !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);

export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  if (!mailConfigured() || !to) return false;
  try {
    const res = await fetch(`${(process.env.RESEND_API_URL || 'https://api.resend.com').replace(/\/$/, '')}/emails`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error('mail', res.status, await res.text());
    return res.ok;
  } catch (e) {
    console.error('mail', e);
    return false;
  }
}
