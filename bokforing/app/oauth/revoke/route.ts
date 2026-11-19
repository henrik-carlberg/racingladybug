import { OAuthError, revokeToken } from '@/lib/services/oauth';
import { basicAuth, readForm } from '@/lib/server/oauth-http';

/** RFC 7009: appen återkallar en token. Svarar 200 även för okända tokens. */
export async function POST(req: Request) {
  const f = await readForm(req);
  try { await revokeToken(f.token ?? '', basicAuth(req), f); } catch (e) {
    if (e instanceof OAuthError) return new Response(JSON.stringify({ error: e.code }), { status: e.status, headers: { 'content-type': 'application/json' } });
    throw e;
  }
  return new Response(null, { status: 200 });
}
