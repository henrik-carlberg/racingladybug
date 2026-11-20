import { cookies } from 'next/headers';
import { AppError } from '@/lib/errors';
import { createSession, logLogin } from '@/lib/server/auth';
import { requestOrigin } from '@/lib/server/origin';
import { ssoComplete } from '@/lib/services/company-login';
import { audit } from '@/lib/server/audit';
import { sql } from '@/lib/db';

const to = (origin: string, path: string, error?: string) => Response.redirect(`${origin}${path}${error ? `?error=${encodeURIComponent(error)}` : ''}`, 303);

/** Svaret från bolagets identitetsleverantör (OIDC authorization code med PKCE) */
export async function GET(req: Request) {
  const origin = await requestOrigin();
  const u = new URL(req.url);
  const jar = await cookies();
  const cookieState = jar.get('sso_state')?.value;
  jar.delete({ name: 'sso_state', path: '/api/sso' });
  if (u.searchParams.get('error')) return to(origin, '/login', 'Inloggningen avbröts hos identitetsleverantören');
  try {
    const r = await ssoComplete(origin, u.searchParams.get('state') ?? '', cookieState, u.searchParams.get('code') ?? '');
    await createSession(r.userId, { method: 'sso', mfa: r.mfa });
    await audit(sql, { companyId: r.companyId, userId: r.userId, action: 'login_sso', entity: 'user', entityId: r.userId }).catch(() => {});
    return to(origin, `/c/${r.companyId}`);
  } catch (e) {
    const known = e instanceof AppError;
    if (!known) console.error('sso', e);
    await logLogin({ userId: null, method: 'sso', success: false, reason: known ? (e as Error).message : 'Fel vid inloggning' });
    return to(origin, '/login', known ? (e as Error).message : 'Inloggningen misslyckades – försök igen');
  }
}
