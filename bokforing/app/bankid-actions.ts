'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/server/auth';
import { requestOrigin } from '@/lib/server/origin';
import { limit, clientIp } from '@/lib/server/ratelimit';
import { startFlow, unlinkBankId, type Purpose } from '@/lib/services/bankid';
import { signingTitle } from '@/lib/services/documents';
import { done } from '@/lib/server/action';

/** Sparar state i en cookie (binder svaret till den här webbläsaren) och skickar vidare till BankID-leverantören */
async function go(o: Parameters<typeof startFlow>[1], errorBack: string) {
  let url = '';
  try {
    await limit(`bankid:${await clientIp()}`, 30, 600);
    const f = await startFlow(await requestOrigin(), o);
    (await cookies()).set('bankid_state', f.state, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/api/bankid', maxAge: 900 });
    url = f.url;
  } catch (e) {
    redirect(`${errorBack}${errorBack.includes('?') ? '&' : '?'}error=${encodeURIComponent(e instanceof Error ? e.message : 'BankID kunde inte startas')}`);
  }
  redirect(url);
}

export async function bankidLogin() { await go({ purpose: 'login' as Purpose, back: '/' }, '/login'); }

export async function bankidLink() {
  const user = await requireUser();
  await go({ purpose: 'link', userId: user.id, back: '/konto#bankid' }, '/konto');
}

export async function bankidUnlink() {
  const user = await requireUser();
  await unlinkBankId(user.id);
  done('/konto#bankid', 'BankID är bortkopplat');
}

/** Inloggad undertecknare */
export async function bankidSign(signerId: number, path: string) {
  const user = await requireUser();
  const d = await signingTitle({ signerId, userId: user.id });
  const back = path.startsWith('/c/') ? path : '/';
  if (!d) redirect(`${back}?error=${encodeURIComponent('Dokumentet går inte att signera')}`);
  await go({ purpose: 'sign', userId: user.id, signerId, back, message: `Jag signerar ${d.title}. Dokumentets kontrollsumma (SHA-256): ${d.sha256.slice(0, 16)}…` }, back);
}

/** Undertecknare via länk */
export async function bankidSignLink(token: string) {
  const d = await signingTitle({ token });
  const back = `/sign/${encodeURIComponent(token)}`;
  if (!d) redirect(`${back}?error=${encodeURIComponent('Dokumentet går inte att signera')}`);
  await go({ purpose: 'sign', signToken: token, back, message: `Jag signerar ${d.title}. Dokumentets kontrollsumma (SHA-256): ${d.sha256.slice(0, 16)}…` }, back);
}
