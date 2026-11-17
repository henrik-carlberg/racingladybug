import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createHmac } from 'node:crypto';
import { access, monthlyPrice } from '@/lib/billing';
import { formEncode, verifyStripeSignature } from '@/lib/server/stripe';

describe('abonnemang', () => {
  it('pris: grund + betalda moduler (CRM ingår)', () => {
    expect(monthlyPrice([])).toEqual({ base: 9900, modules: 0, paid: [], total: 9900 });
    expect(monthlyPrice(['crm', 'projekt', 'lager']).total).toBe(9900 + 2 * 3900);
  });
  it('åtkomst', () => {
    const t = '2026-11-17';
    expect(access({ exempt: true, status: null, trialEndsAt: null, periodEnd: null, today: t }).state).toBe('exempt');
    expect(access({ exempt: false, status: 'trialing', trialEndsAt: '2026-11-30', periodEnd: null, today: t })).toEqual({ state: 'trial', daysLeft: 13 });
    expect(access({ exempt: false, status: 'trialing', trialEndsAt: '2026-11-16', periodEnd: null, today: t }).state).toBe('locked');
    expect(access({ exempt: false, status: 'active', trialEndsAt: '2026-01-01', periodEnd: null, today: t }).state).toBe('active');
    expect(access({ exempt: false, status: 'past_due', trialEndsAt: null, periodEnd: '2026-11-10', today: t })).toEqual({ state: 'past_due', daysLeft: 7 });
    expect(access({ exempt: false, status: 'past_due', trialEndsAt: null, periodEnd: '2026-10-01', today: t }).state).toBe('locked');
    expect(access({ exempt: false, status: 'canceled', trialEndsAt: null, periodEnd: '2026-12-01', today: t }).state).toBe('active');
    expect(access({ exempt: false, status: 'canceled', trialEndsAt: null, periodEnd: '2026-11-01', today: t }).state).toBe('locked');
  });
});

describe('Stripe', () => {
  it('formulärkodning', () => {
    expect(decodeURIComponent(formEncode({ mode: 'subscription', line_items: [{ quantity: 1, price_data: { unit_amount: 9900 } }], meta: { a: 'b' } })))
      .toBe('mode=subscription&line_items[0][quantity]=1&line_items[0][price_data][unit_amount]=9900&meta[a]=b');
  });
  it('signatur', () => {
    const payload = '{"type":"x"}', secret = 'whsec_test', t = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
    expect(verifyStripeSignature(payload, `t=${t},v1=${sig}`, secret)).toBe(true);
    expect(verifyStripeSignature(payload + ' ', `t=${t},v1=${sig}`, secret)).toBe(false);
    expect(verifyStripeSignature(payload, `t=${t - 1000},v1=${sig}`, secret)).toBe(false);
    expect(verifyStripeSignature(payload, null, secret)).toBe(false);
  });
});
