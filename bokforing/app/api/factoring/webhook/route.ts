import { verifyFactoringWebhook } from '@/lib/server/factoring';
import { refreshDeal } from '@/lib/services/finance';

export const dynamic = 'force-dynamic';

/** Finansiären meddelar ändrad status (signerat). Statusen hämtas sedan från finansiärens API. */
export async function POST(req: Request) {
  if (!process.env.FACTORING_WEBHOOK_SECRET) return new Response('Inte konfigurerad', { status: 503 });
  const body = await req.text();
  if (body.length > 100_000) return new Response('För stor', { status: 413 });
  if (!verifyFactoringWebhook(body, req.headers.get('x-factoring-signature'))) return new Response('Ogiltig signatur', { status: 401 });
  let id = '';
  try { id = String((JSON.parse(body) as { id?: unknown }).id ?? ''); } catch { return new Response('Ogiltig JSON', { status: 400 }); }
  if (!id || id.length > 100) return new Response('Id saknas', { status: 400 });
  const status = await refreshDeal(id).catch((e) => { console.error('factoring webhook', e instanceof Error ? e.message : e); return null; });
  return Response.json({ status });
}
