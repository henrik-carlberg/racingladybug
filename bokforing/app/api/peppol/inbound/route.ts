import { enqueue } from '@/lib/server/jobs';
import { verifyApWebhook } from '@/lib/server/peppol-ap';
import { handleApEvent } from '@/lib/services/peppol';

export const dynamic = 'force-dynamic';

/** Webhook från Peppol-åtkomstpunkten: mottagna e-fakturor och leveransstatus för skickade */
export async function POST(req: Request) {
  const secret = process.env.PEPPOL_AP_WEBHOOK_SECRET;
  if (!secret) return new Response('Inte konfigurerad', { status: 503 });
  const body = await req.text();
  if (body.length > 15_000_000) return new Response('För stor', { status: 413 });
  if (!verifyApWebhook(secret, { timestamp: req.headers.get('x-peppol-timestamp'), signature: req.headers.get('x-peppol-signature') }, body)) return new Response('Ogiltig signatur', { status: 401 });
  let event: Parameters<typeof handleApEvent>[0];
  try { event = JSON.parse(body); } catch { return new Response('Ogiltig JSON', { status: 400 }); }
  const ids = await handleApEvent(event);
  for (const id of ids) await enqueue('inbox.process', { id });
  return Response.json({ received: ids.length });
}
