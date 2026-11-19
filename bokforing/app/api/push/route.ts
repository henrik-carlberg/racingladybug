import { currentUser } from '@/lib/server/auth';
import { subscribe, unsubscribe } from '@/lib/services/push';
import { limit } from '@/lib/server/ratelimit';

/** Webbläsaren registrerar (POST) eller avregistrerar (DELETE) en enhet för pushnotiser. Bara från appen själv. */
async function guard(req: Request) {
  const origin = req.headers.get('origin');
  if (!origin || new URL(origin).host !== req.headers.get('host')) return { error: new Response(null, { status: 403 }) };
  const user = await currentUser();
  if (!user) return { error: new Response(null, { status: 401 }) };
  let body: Record<string, unknown>;
  try { body = JSON.parse((await req.text()).slice(0, 4000)); } catch { return { error: new Response(null, { status: 400 }) }; }
  return { user, body };
}

export async function POST(req: Request) {
  const g = await guard(req);
  if ('error' in g) return g.error;
  try {
    await limit(`push-sub:${g.user.id}`, 30, 3600);
    await subscribe(g.user.id, g.body as never, String(req.headers.get('user-agent') ?? ''));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const g = await guard(req);
  if ('error' in g) return g.error;
  await unsubscribe(g.user.id, String(g.body.endpoint ?? ''));
  return Response.json({ ok: true });
}
