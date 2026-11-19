import { OAuthError, token } from '@/lib/services/oauth';
import { clientIp } from '@/lib/server/ratelimit';
import { hit } from '@/lib/server/ratelimit';
import { basicAuth, readForm } from '@/lib/server/oauth-http';

export const dynamic = 'force-dynamic';
const out = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', pragma: 'no-cache' } });

/** OAuth 2 token-endpoint: authorization_code (med PKCE) och refresh_token */
export async function POST(req: Request) {
  const rl = await hit(`oauthtoken:${await clientIp()}`, 60, 60);
  if (!rl.ok) return out(429, { error: 'slow_down', error_description: 'För många försök' });
  try {
    return out(200, await token(await readForm(req), basicAuth(req)));
  } catch (e) {
    if (e instanceof OAuthError) return out(e.status, { error: e.code, error_description: e.message });
    throw e;
  }
}
