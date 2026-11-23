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

import { payoutLines, saleLines, saleSplit } from '@/lib/commission-sales';
describe('Kommissionsförsäljning', () => {
  it('fördelning och kontering', () => {
    const p = saleSplit({ gross: 250000, vatRate: 25, commissionPct: 30, principalVatRegistered: false });
    expect(p).toEqual({ net: 200000, vat: 50000, commission: 60000, share: 140000, principalVat: 0, payable: 140000 });
    const r = saleSplit({ gross: 125000, vatRate: 25, commissionPct: 20, principalVatRegistered: true });
    expect(r).toMatchObject({ commission: 20000, share: 80000, principalVat: 20000, payable: 100000 });
    const lines = saleLines(r, 25, 1930);
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(0);
    expect(lines).toContainEqual({ account: 2641, amount: 20000 });
    expect(payoutLines(140000)).toEqual([{ account: 2895, amount: 140000 }, { account: 1930, amount: -140000 }]);
  });
});

import { reduction, saleLines as powerSale, yearSummary } from '@/lib/power';
describe('Egen elproduktion', () => {
  it('skattereduktion, kontering och sammanställning', () => {
    expect(reduction(2025, 1500, 250)).toEqual({ basis: 250, rate: 60, amount: 15000 });
    expect(reduction(2025, 40000, 50000)).toMatchObject({ basis: 30000, amount: 1800000 });
    expect(reduction(2099, 100, 100)).toMatchObject({ rate: null, amount: null });
    expect(powerSale(42000, 25, 3060)).toEqual([{ account: 1930, amount: 52500 }, { account: 3060, amount: -42000 }, { account: 2611, amount: -10500 }]);
    expect(powerSale(42000, 0, 3060)).toHaveLength(2);
    expect(yearSummary([{ produced_kwh: 1200, sold_kwh: 700, sold_amount: 42000 }, { produced_kwh: 1300, sold_kwh: 800, sold_amount: 48000 }], 20000, 1100000))
      .toEqual({ produced: 2500, sold: 1500, own: 1000, revenue: 110000, payback: 10 });
  });
});

import { changeLines, paymentLines as subsidyPayment, receivableLines, valuation } from '@/lib/farming';
describe('Lantbruk', () => {
  it('stöd och djurvärdering', () => {
    expect(receivableLines(11500000)).toEqual([{ account: 1684, amount: 11500000 }, { account: 3981, amount: -11500000 }]);
    expect(subsidyPayment(11650000, 11500000)).toEqual([{ account: 1930, amount: 11650000 }, { account: 1684, amount: -11500000 }, { account: 3981, amount: -150000 }]);
    expect(subsidyPayment(100, 0)).toEqual([{ account: 1930, amount: 100 }, { account: 3981, amount: -100 }]);
    expect(valuation([{ type: 'Ko', heads: 38, value_per_head: 1500000 }, { type: 'Kalv', heads: 15, value_per_head: 300000 }, { type: 'Get', heads: 0, value_per_head: 1 }]).value).toBe(61500000);
    expect(changeLines(-1500000)).toEqual([{ account: 1450, amount: -1500000 }, { account: 4950, amount: 1500000 }]);
  });
});

import { change, indexFactor, indexedPrice } from '@/lib/indexation';
describe('Indexuppräkning', () => {
  it('faktor, golv och andel', () => {
    expect(indexFactor({ base: 400, current: 412, share: 100, floor: true })).toBe(1.03);
    expect(indexFactor({ base: 400, current: 412, share: 50, floor: true })).toBe(1.015);
    expect(indexFactor({ base: 400, current: 390, share: 100, floor: true })).toBe(1);
    expect(indexFactor({ base: 400, current: 390, share: 100, floor: false })).toBe(0.975);
    expect(indexedPrice(25000, 1.03)).toBe(25750);
    expect(change(150000, 154500)).toEqual({ diff: 4500, pct: 3 });
  });
});
