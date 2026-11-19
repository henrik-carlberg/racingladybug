import { verifyCollectionWebhook } from '@/lib/server/collection';
import { refreshCase } from '@/modules/reskontra/service';

export const dynamic = 'force-dynamic';

/** Inkassobolaget meddelar att ett ärende har ändrats (signerat med HMAC). Statusen hämtas sedan från deras API. */
export async function POST(req: Request) {
  if (!process.env.INKASSO_WEBHOOK_SECRET) return new Response('Inte konfigurerad', { status: 503 });
  const body = await req.text();
  if (body.length > 100_000) return new Response('För stor', { status: 413 });
  if (!verifyCollectionWebhook(body, req.headers.get('x-inkasso-signature'))) return new Response('Ogiltig signatur', { status: 401 });
  let id = '';
  try { id = String((JSON.parse(body) as { case_id?: unknown }).case_id ?? ''); } catch { return new Response('Ogiltig JSON', { status: 400 }); }
  if (!id || id.length > 100) return new Response('Ärende saknas', { status: 400 });
  const status = await refreshCase(id).catch((e) => { console.error('inkasso webhook', e instanceof Error ? e.message : e); return null; });
  return Response.json({ status });
}
