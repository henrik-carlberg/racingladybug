import { describe, expect, it } from 'vitest';
import { customerAccrualLines, parseTiers, rebate } from '@/lib/rebates';

describe('Kundbonus', () => {
  it('trappsteg och kontering', () => {
    const t = parseTiers('500000:2; 1000000:3');
    expect(t).toEqual([{ from: 50000000, pct: 200 }, { from: 100000000, pct: 300 }]);
    expect(rebate(40000000, t)).toMatchObject({ pct: 0, amount: 0, toNext: 10000000 });
    expect(rebate(60000000, t)).toMatchObject({ pct: 200, amount: 1200000 });
    expect(rebate(120000000, t)).toMatchObject({ pct: 300, amount: 3600000, next: null });
    expect(() => parseTiers('abc')).toThrow();
    expect(customerAccrualLines(1200000)).toEqual([{ account: 3730, amount: 1200000 }, { account: 2990, amount: -1200000 }]);
  });
});

import { prepayLines, settleLines } from '@/lib/supplier-prepayment';
describe('Leverantörsförskott', () => {
  it('kontering', () => {
    expect(prepayLines(3000000)).toEqual([{ account: 1480, amount: 3000000 }, { account: 1930, amount: -3000000 }]);
    expect(settleLines(3000000)).toEqual([{ account: 2440, amount: 3000000 }, { account: 1480, amount: -3000000 }]);
  });
});
