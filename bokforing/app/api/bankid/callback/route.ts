import { AppError } from '@/lib/errors';
import { cookies } from 'next/headers';
import { createSession, currentUser } from '@/lib/server/auth';
import { clientInfo, requestOrigin } from '@/lib/server/origin';
import { completeFlow, hasBankId, linkBankId, maskPnr, samePerson, userByPnr } from '@/lib/services/bankid';
import { signWithBankId } from '@/lib/services/documents';
import { audit } from '@/lib/server/audit';
import { sql } from '@/lib/db';

const to = (origin: string, path: string, msg: { ok?: string; error?: string }) => {
  const [p, hash] = path.split('#');
  const q = msg.error ? `error=${encodeURIComponent(msg.error)}` : msg.ok ? `ok=${encodeURIComponent(msg.ok)}` : '';
  return Response.redirect(`${origin}${p}${q ? (p.includes('?') ? '&' : '?') + q : ''}${hash ? `#${hash}` : ''}`, 303);
};

/** Svaret från BankID-leverantören (OIDC authorization code) */
export async function GET(req: Request) {
  const origin = await requestOrigin();
  const u = new URL(req.url);
  const jar = await cookies();
  const cookieState = jar.get('bankid_state')?.value;
  jar.delete({ name: 'bankid_state', path: '/api/bankid' });
  if (u.searchParams.get('error')) return to(origin, '/login', { error: 'BankID-legitimeringen avbröts' });
  let back = '/login';
  try {
    const { flow, verified } = await completeFlow(origin, u.searchParams.get('state') ?? '', cookieState, u.searchParams.get('code') ?? '');
    back = flow.back;
    if (flow.purpose === 'login') {
      const id = await userByPnr(verified.pnr);
      if (!id) return to(origin, '/login', { error: 'Inget konto är kopplat till ditt BankID. Logga in med e-post och koppla BankID under Mitt konto.' });
      await createSession(id);
      await audit(sql, { companyId: null, userId: id, action: 'login_bankid', entity: 'user', entityId: id }).catch(() => {});
      return to(origin, '/', {});
    }
    const me = await currentUser();
    if (flow.purpose === 'link') {
      if (!me || me.id !== flow.user_id) return to(origin, '/login', { error: 'Logga in igen och försök på nytt' });
      await linkBankId(me.id, verified.pnr);
      return to(origin, flow.back, { ok: `BankID är kopplat (${maskPnr(verified.pnr)})` });
    }
    // Signering
    const evidence = { pnrMasked: maskPnr(verified.pnr), name: verified.name, idTokenHash: verified.idTokenHash, issuer: verified.claims.iss };
    if (flow.signer_id) {
      if (!me || me.id !== flow.user_id) return to(origin, flow.back, { error: 'Logga in igen och försök på nytt' });
      if (!(await samePerson(me.id, verified.pnr))) return to(origin, flow.back, { error: (await hasBankId(me.id)) ? 'BankID tillhör en annan person än den som är kopplad till ditt konto' : 'Koppla ditt BankID under Mitt konto innan du signerar med BankID' });
      await signWithBankId({ signerId: flow.signer_id, userId: me.id }, evidence, await clientInfo());
    } else if (flow.sign_token) {
      await signWithBankId({ token: flow.sign_token }, evidence, await clientInfo());
    }
    return to(origin, flow.back, { ok: 'Dokumentet är signerat med BankID' });
  } catch (e) {
    const known = e instanceof AppError;
    if (!known) console.error('bankid', e);
    return to(origin, back, { error: known ? (e as Error).message : 'BankID-legitimeringen misslyckades – försök igen' });
  }
}
