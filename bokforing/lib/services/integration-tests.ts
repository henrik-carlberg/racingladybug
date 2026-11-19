import 'server-only';
import { sendMail } from '@/lib/server/mail';

/** Snabbtest av en integration. Returnerar ett meddelande att visa (aldrig nycklar). */
export async function testIntegration(key: string, user: { id: number; email: string }): Promise<{ ok: boolean; message: string }> {
  const t0 = Date.now();
  const ms = () => `${Date.now() - t0} ms`;
  try {
    if (key === 'mail') {
      const ok = await sendMail(user.email, 'Test från bokföringen', 'Det här är ett testmejl. E-posten fungerar.');
      return ok ? { ok, message: `Testmejl skickat till ${user.email} (${ms()})` } : { ok, message: 'Resend tog inte emot mejlet – kontrollera nyckeln och avsändaradressen (MAIL_FROM måste vara på en verifierad domän)' };
    }
    if (key === 'push') {
      const { sendToUsers } = await import('./push');
      const n = await sendToUsers([user.id], 'test', { title: 'Testnotis', body: 'Pushnotiserna fungerar.', url: '/konto#notiser' });
      return n ? { ok: true, message: `Testnotis skickad till ${n} enhet(er)` } : { ok: false, message: 'Nycklarna finns, men du har ingen enhet med notiser påslagna. Slå på notiser under Mitt konto och testa igen.' };
    }
    if (key === 'bankid') {
      const issuer = (process.env.BANKID_OIDC_ISSUER ?? '').replace(/\/$/, '');
      const r = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(8000), redirect: 'error' });
      const d = r.ok ? await r.json() as { authorization_endpoint?: string; token_endpoint?: string } : null;
      return d?.authorization_endpoint && d.token_endpoint ? { ok: true, message: `Leverantören svarar (${ms()}). Gör en testinloggning under Mitt konto.` } : { ok: false, message: `Leverantören svarade ${r.status} – kontrollera BANKID_OIDC_ISSUER` };
    }
    if (key === 'ai') {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const c = new Anthropic();
      const r = await c.messages.create({ model: process.env.ASSISTANT_MODEL || 'claude-opus-5-5', max_tokens: 8, messages: [{ role: 'user', content: 'Svara med ordet OK.' }] });
      return { ok: true, message: `Claude svarar (${ms()}, modell ${r.model})` };
    }
    if (key === 'bank') {
      const { listAspsps } = await import('@/lib/bank/enablebanking');
      const banks = await listAspsps('SE');
      return { ok: banks.length > 0, message: banks.length ? `Enable Banking svarar, ${banks.length} svenska banker (${ms()})` : 'Enable Banking svarade men utan banker' };
    }
    if (key === 'stripe') {
      const r = await fetch(`${(process.env.STRIPE_API_URL || 'https://api.stripe.com').replace(/\/$/, '')}/v1/balance`, { headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` }, signal: AbortSignal.timeout(8000) });
      return r.ok ? { ok: true, message: `Stripe svarar (${ms()})${process.env.STRIPE_SECRET_KEY?.startsWith('sk_test') ? ' – testnyckel' : ''}` } : { ok: false, message: `Stripe svarade ${r.status} – kontrollera STRIPE_SECRET_KEY` };
    }
    return { ok: false, message: 'Den här integrationen kan inte testas härifrån' };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Fel: ${m.replace(/(sk|re|whsec)_[A-Za-z0-9_]+/g, '***').slice(0, 200)}` };
  }
}
