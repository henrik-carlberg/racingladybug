import { describe, expect, it } from 'vitest';
import { acquisitionAnalysis, consolidate, elapsed, inventoryProfit, type GroupCompany } from '@/lib/consolidation';

const bal = (b: Record<string, number>) => {
  const assets = b.fixed + b.current + b.cash;
  return assets - (b.equity + b.untaxed + b.longterm + b.shortterm);
};
describe('Koncernredovisning', () => {
  it('förvärvsanalys med övervärde, uppskjuten skatt och goodwill', () => {
    const a = acquisitionAnalysis({ cost: 1000000, ownership: 80, equity: 500000, surplus: 200000, acquiredOn: '2025-01-01', goodwillYears: 5, surplusYears: 20 }, { from: '2026-01-01', to: '2026-12-31' });
    expect(a.deferredTax).toBe(41200);
    expect(a.fairNet).toBe(658800);
    expect(a.goodwill).toBe(1000000 - Math.round(0.8 * 658800));
    expect(a.minorityAtAcquisition).toBe(131760);
    // Ett år av fem på goodwill i perioden
    expect(Math.abs(a.period.gw - Math.round(a.goodwill / 5))).toBeLessThan(400);
    expect(a.remaining.gw).toBe(a.goodwill - a.accumulated.gw);
    expect(elapsed('2026-01-01', '2026-12-31', 1)).toBeCloseTo(1, 2);
  });
  it('internvinst i lager', () => {
    expect(inventoryProfit(100000, 40000, 25)).toEqual({ closing: 25000, opening: 10000, change: 15000 });
  });
  it('koncernbalansen går ihop med goodwill, övervärden, avskrivning, minoritet och internvinst', () => {
    const parent: GroupCompany = { id: 1, name: 'Moder', result: new Map([[3010, -500000], [4010, 200000]]), balance: new Map([[1310, 1000000], [1930, 500000], [2081, -50000], [2099, -300000], [2091, -1150000]]), intraSales: 0, intraOpen: 0 };
    const sub: GroupCompany = { id: 2, name: 'Dotter', result: new Map([[3010, -300000], [4010, 100000]]), balance: new Map([[1460, 400000], [1930, 400000], [2081, -100000], [2091, -500000], [2099, -200000]]), intraSales: 0, intraOpen: 0 };
    const r = consolidate([parent, sub], { parentId: 1, period: { from: '2026-01-01', to: '2026-12-31' }, links: [{ subsidiaryId: 2, ownership: 80, acquisitionCost: 1000000, acquiredEquity: 500000, acquiredOn: '2025-01-01', goodwillYears: 5, surplus: 200000, surplusYears: 20, intraInventory: 100000, intraInventoryOpening: 40000, intraMargin: 25 }] });
    // Balansräkningen (tillgångar = eget kapital + skulder + minoritet) går ihop även efter elimineringarna
    expect(bal(r.balance) - r.minority).toBe(bal(Object.fromEntries(Object.keys(r.balance).map((k) => [k, r.perCompany.reduce((x, p) => x + (p.b as Record<string, number>)[k], 0)]))));
    expect(bal(r.elimB) - r.minority).toBe(0);
    expect(r.entries.some((e) => e.label.startsWith('Internvinst i lager'))).toBe(true);
    expect(r.elimR.goods).toBe(15000);
    expect(r.analyses[0].a.goodwill).toBeGreaterThan(0);
  });
});

import { dividendPlan, insuranceWritedown, savedSpaceFor, yieldTax } from '@/lib/closely-held';
describe('Fåmansföretag och 3:12', () => {
  it('utdelningsplan för flera ägare', () => {
    const p = dividendPlan(30000000, [{ id: 1, name: 'A', share: 60, limit: 20000000 }, { id: 2, name: 'B', share: 40, limit: 5000000 }]);
    expect(p.rows.map((r) => r.amount)).toEqual([18000000, 12000000]);
    expect(p.rows[1]).toMatchObject({ within: 5000000, above: 7000000, tax: 1000000 });
    expect(p.maxWithin).toBe(12500000); // B:s gränsbelopp 50 000 / 40 %
  });
  it('sparat utdelningsutrymme år för år', () => {
    const h = [{ year: 2024, saved_next: 100 }, { year: 2025, saved_next: 250 }];
    expect(savedSpaceFor(2026, h, 999)).toEqual({ amount: 250, from: 2025 });
    expect(savedSpaceFor(2025, h, 999)).toEqual({ amount: 100, from: 2024 });
    expect(savedSpaceFor(2024, h, 999)).toEqual({ amount: 999, from: null });
  });
  it('avkastningsskatt på kapitalförsäkring och nedskrivning', () => {
    expect(yieldTax({ valueJan1: 100000000, premiumsH1: 10000000, premiumsH2: 10000000, slr: 2.0 })).toEqual({ base: 115000000, rate: 3, tax: 1035000 });
    expect(yieldTax({ valueJan1: 100000000, premiumsH1: 0, premiumsH2: 0, slr: 0 }).rate).toBe(1.25);
    expect(insuranceWritedown(1000, 800)).toBe(200);
    expect(insuranceWritedown(1000, 1200)).toBe(0);
  });
});

import { mealBenefit, representationLines, restaurantZLines } from '@/lib/restaurant';
describe('Hotell och restaurang', () => {
  const sum = (l: { amount: number }[]) => l.reduce((s, x) => s + x.amount, 0);
  it('dagskassa med mat 12 %, alkohol 25 % och kortdricks', () => {
    const z = restaurantZLines({ food: 1120000, alcohol: 250000, tips: 30000, payments: { card: 1000000, cash: 400000 } });
    expect(sum(z.lines)).toBe(0);
    expect(z.lines).toContainEqual({ account: 2897, amount: -30000, description: 'Kortdricks till personalen' });
    expect(z.lines).toContainEqual({ account: 2621, amount: -120000 });
    expect(z.lines).toContainEqual({ account: 2611, amount: -50000 });
    expect(() => restaurantZLines({ food: 1000, alcohol: 0, tips: 0, payments: { card: 900 } })).toThrow();
  });
  it('personalmat: förmånsvärde, skattepliktigt och uttagsmoms', () => {
    expect(mealBenefit({ breakfasts: 0, lunches: 10, dinners: 0, paid: 30000 }, { breakfast: 6500, lunch: 13000, dinner: 13000 })).toEqual({ value: 130000, taxable: 100000, vat: 13929 });
  });
  it('representation med blandad moms och tak 300 kr per person', () => {
    const r = representationLines({ food: 112000, drinks: 50000, persons: 2 });
    expect(r.deductible).toBe(9429);
    expect(r.vat).toBe(22000);
    expect(sum(r.lines)).toBe(0);
    expect(representationLines({ food: 11200, drinks: 0, persons: 4 }).deductible).toBe(1200);
  });
});
