import { checkSwish } from '@/lib/services/paid-faster';
import { clientIp, limit, RateLimitError } from '@/lib/server/ratelimit';

export const dynamic = 'force-dynamic';

/** Swish meddelar att en betalningsförfrågan har ändrats. Innehållet litas inte på – statusen hämtas från Swish. */
export async function POST(req: Request) {
  try { await limit(`swish-cb:${await clientIp()}`, 120, 60); } catch (e) { if (e instanceof RateLimitError) return new Response('För många', { status: 429 }); throw e; }
  const body = await req.text();
  if (body.length > 10_000) return new Response('För stor', { status: 413 });
  let id = '';
  try { id = String((JSON.parse(body) as { id?: unknown }).id ?? ''); } catch { return new Response('Ogiltig JSON', { status: 400 }); }
  if (!/^[0-9A-Fa-f]{32}$/.test(id)) return new Response('Ogiltigt id', { status: 400 });
  try { await checkSwish(id.toUpperCase()); } catch (e) { console.error('swish callback', e instanceof Error ? e.message : e); }
  return new Response(null, { status: 200 });
}
