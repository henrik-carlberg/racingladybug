'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { requestOrigin } from '@/lib/server/origin';
import { clientIp, limit } from '@/lib/server/ratelimit';
import { ssoStart } from '@/lib/services/company-login';

/** Startar företagsinloggning: state i en cookie binder svaret till webbläsaren */
export async function ssoLogin(fd: FormData) {
  let url = '';
  try {
    await limit(`sso:${await clientIp()}`, 30, 600);
    const f = await ssoStart(await requestOrigin(), String(fd.get('email') ?? ''));
    (await cookies()).set('sso_state', f.state, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/api/sso', maxAge: 900 });
    url = f.url;
  } catch (e) {
    redirect(`/login?error=${encodeURIComponent(e instanceof Error ? e.message : 'Företagsinloggningen kunde inte startas')}`);
  }
  redirect(url);
}
