import { after } from 'next/server';
import { verifySvix } from '@/lib/inbox';
import { processDocument, receiveResendEmail } from '@/lib/services/inbox';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Webhook från Resend (email.received): leverantörsfakturor som mejlats till bolagets inkorgsadress */
export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return new Response('Inte konfigurerad', { status: 503 });
  const body = await req.text();
  const ok = verifySvix(secret, { id: req.headers.get('svix-id'), timestamp: req.headers.get('svix-timestamp'), signature: req.headers.get('svix-signature') }, body);
  if (!ok) return new Response('Ogiltig signatur', { status: 401 });
  const event = JSON.parse(body) as { type: string; data: Parameters<typeof receiveResendEmail>[0] };
  if (event.type !== 'email.received') return Response.json({ ignored: event.type });
  // Fel här ger 500 så att Resend försöker igen; samma mejl sparas bara en gång
  const ids = await receiveResendEmail(event.data);
  after(async () => { for (const id of ids) await processDocument(id); });
  return Response.json({ received: ids.length });
}
