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
