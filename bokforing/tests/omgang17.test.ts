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
