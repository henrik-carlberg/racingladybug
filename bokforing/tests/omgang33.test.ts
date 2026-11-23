import { describe, expect, it } from 'vitest';
import { expiresSoon, margin, priceFor } from '@/lib/customer-prices';

describe('Kundprisavtal', () => {
  it('lägsta gällande pris, marginal och utgång', () => {
    const vol = { id: 1, scope: 'group' as const, net_price: null, discount_pct: 15, min_qty: 50, valid_from: '2026-01-01', valid_to: null };
    const net = { id: 2, scope: 'customer' as const, net_price: 8000, discount_pct: null, min_qty: 0, valid_from: '2026-01-01', valid_to: '2026-06-30' };
    expect(priceFor({ list: 10000, groupDiscount: 10, agreements: [vol], qty: 10, date: '2026-03-01' })).toMatchObject({ price: 9000, agreementId: null });
    expect(priceFor({ list: 10000, groupDiscount: 10, agreements: [vol], qty: 60, date: '2026-03-01' })).toMatchObject({ price: 8500, agreementId: 1 });
    expect(priceFor({ list: 10000, groupDiscount: 0, agreements: [net], qty: 1, date: '2026-03-01' }).price).toBe(8000);
    expect(priceFor({ list: 10000, groupDiscount: 0, agreements: [net], qty: 1, date: '2026-07-01' }).price).toBe(10000);
    expect(margin(600000, 420000)).toMatchObject({ margin: 180000, pct: 30 });
    expect(expiresSoon('2026-12-01', '2026-11-23')).toBe(true);
    expect(expiresSoon('2027-03-01', '2026-11-23')).toBe(false);
  });
});
