import { verifyCreditWebhook } from '@/lib/server/credit';
import { onMonitorEvent } from '@/lib/services/credit';

export const dynamic = 'force-dynamic';

/** Bevakningshändelse från kreditupplysningen (signerad). Upplysningen hämtas om från tjänsten – innehållet i anropet litas inte på. */
export async function POST(req: Request) {
  if (!process.env.CREDIT_WEBHOOK_SECRET) return new Response('Inte konfigurerad', { status: 503 });
  const body = await req.text();
  if (body.length > 100_000) return new Response('För stor', { status: 413 });
  if (!verifyCreditWebhook(body, req.headers.get('x-credit-signature'))) return new Response('Ogiltig signatur', { status: 401 });
  let id = '';
  try { id = String((JSON.parse(body) as { monitor_id?: unknown }).monitor_id ?? ''); } catch { return new Response('Ogiltig JSON', { status: 400 }); }
  if (!id || id.length > 100) return new Response('Id saknas', { status: 400 });
  return Response.json({ customers: await onMonitorEvent(id) });
}
