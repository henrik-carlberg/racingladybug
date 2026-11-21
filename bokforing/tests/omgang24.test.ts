import { describe, expect, it } from 'vitest';
import { distributionLines, gains } from '@/lib/liquidation';

describe('Skifte vid likvidation', () => {
  it('eget kapital och resultat mot kassan', () => {
    const r = distributionLines(new Map([[1930, 3500000], [2081, -2500000], [3010, -1000000]]));
    expect(r.net).toBe(3500000);
    expect(r.lines).toEqual([{ account: 1930, amount: -3500000 }, { account: 2081, amount: 2500000 }, { account: 2099, amount: 1000000 }]);
    expect(() => distributionLines(new Map([[1930, 100], [1220, 100], [2081, -200]]))).toThrow(/konto 1220/);
    expect(gains([{ name: 'A', amount: 2100000, costBasis: 1500000 }])[0].gain).toBe(600000);
  });
});
