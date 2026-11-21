import { describe, expect, it } from 'vitest';
import { acquisitionLines, allocate } from '@/lib/business-acquisition';

describe('Inkråmsköp', () => {
  const assets = [{ account: 1220, label: 'Inv', amount: 20000000 }, { account: 1460, label: 'Lager', amount: 10000000 }];
  const liabilities = [{ account: 2920, label: 'Semester', amount: 5000000 }];
  it('goodwill och verifikation', () => {
    expect(allocate(50000000, assets, liabilities)).toEqual({ assets: 30000000, liabilities: 5000000, goodwill: 25000000 });
    const l = acquisitionLines(50000000, assets, liabilities, 1930);
    expect(l).toContainEqual({ account: 1070, amount: 25000000 });
    expect(l.reduce((s, x) => s + x.amount, 0)).toBe(0);
    expect(() => acquisitionLines(10000000, assets, [], 1930)).toThrow(/negativ goodwill/);
  });
});

import { settleLines, value, yearEnd } from '@/lib/fx-forwards';
describe('Valutaterminer', () => {
  it('värde, reserv enligt lägsta värdets princip och avräkning', () => {
    expect(value('sell', 100000, 11.5, 11.2)).toBe(3000000);
    expect(value('buy', 100000, 11.5, 11.2)).toBe(-3000000);
    expect(yearEnd({ dir: 'sell', amount: 100000, forwardRate: 11.5, closingRate: 11.8, hedging: false, reserved: 0 })).toEqual({ value: -3000000, reserve: 3000000, change: 3000000 });
    expect(yearEnd({ dir: 'sell', amount: 100000, forwardRate: 11.5, closingRate: 11.2, hedging: false, reserved: 0 }).change).toBe(0);
    expect(yearEnd({ dir: 'sell', amount: 100000, forwardRate: 11.5, closingRate: 11.8, hedging: true, reserved: 0 }).change).toBe(0);
    expect(settleLines(-2000000, 3000000)).toEqual([{ account: 1930, amount: -2000000 }, { account: 7960, amount: 2000000 }, { account: 2990, amount: 3000000 }, { account: 8390, amount: -3000000 }]);
  });
});

import { payoutLines, rate, tax } from '@/lib/withholding';
describe('Kupongskatt', () => {
  it('sats efter mottagare och avtal', () => {
    expect(rate({ country: 'NO', type: 'person', holdingPct: 5, businessRelated: false, treatyRate: null }).pct).toBe(15);
    expect(rate({ country: 'BR', type: 'person', holdingPct: 5, businessRelated: false, treatyRate: null }).pct).toBe(30);
    expect(rate({ country: 'DE', type: 'company', holdingPct: 25, businessRelated: false, treatyRate: null }).pct).toBe(0);
    expect(rate({ country: 'US', type: 'company', holdingPct: 5, businessRelated: true, treatyRate: null }).pct).toBe(0);
    expect(rate({ country: 'US', type: 'person', holdingPct: 5, businessRelated: false, treatyRate: 10 }).pct).toBe(10);
    expect(tax(1000000, 15)).toBe(150000);
    expect(payoutLines(1000000, 150000)).toEqual([{ account: 2898, amount: 1000000 }, { account: 2750, amount: -150000 }, { account: 1930, amount: -850000 }]);
  });
});
