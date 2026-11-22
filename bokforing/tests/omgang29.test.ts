import { describe, expect, it } from 'vitest';
import { applicable, creditLines, refundLines } from '@/lib/supplier-credit';

describe('Leverantörskrediter', () => {
  it('kontering och kvittning', () => {
    expect(creditLines([{ account: 4010, amount: 200000 }], 50000)).toEqual([{ account: 2440, amount: 250000 }, { account: 4010, amount: -200000 }, { account: 2641, amount: -50000 }]);
    expect(refundLines(125000)).toEqual([{ account: 1930, amount: 125000 }, { account: 2440, amount: -125000 }]);
    expect(applicable(250000, 1000000)).toBe(250000);
    expect(applicable(250000, 100000)).toBe(100000);
  });
});
