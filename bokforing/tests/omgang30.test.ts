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

import { accrualLines, profitShare } from '@/lib/profit-share';
describe('Tantiem', () => {
  it('beräkning och kontering', () => {
    expect(profitShare({ kind: 'percent', pct: 500, target: null, amount: null, cap: null }, 100000000)).toBe(5000000);
    expect(profitShare({ kind: 'percent', pct: 500, target: null, amount: null, cap: 3000000 }, 100000000)).toBe(3000000);
    expect(profitShare({ kind: 'percent', pct: 500, target: null, amount: null, cap: null }, -100000)).toBe(0);
    expect(profitShare({ kind: 'target', pct: null, target: 50000000, amount: 2000000, cap: null }, 49999900)).toBe(0);
    expect(profitShare({ kind: 'target', pct: null, target: 50000000, amount: 2000000, cap: null }, 50000000)).toBe(2000000);
    expect(accrualLines(5000000, 1571000)).toEqual([{ account: 7210, amount: 5000000 }, { account: 2910, amount: -5000000 }, { account: 7519, amount: 1571000 }, { account: 2940, amount: -1571000 }]);
  });
});

import { reductionLines } from '@/lib/disputes';
describe('Förlikning', () => {
  it('nedsättning med momsreduktion', () => {
    const inv = [{ account: 1510, amount: 1250000 }, { account: 3001, amount: -1000000 }, { account: 2611, amount: -250000 }];
    expect(reductionLines(inv, 450000)).toEqual([{ account: 3730, amount: 360000 }, { account: 2611, amount: 90000 }, { account: 1510, amount: -450000 }]);
  });
});

import { supplierAccrualLines, supplierSettlementLines } from '@/lib/rebates';
describe('Leverantörsbonus', () => {
  it('kontering', () => {
    expect(supplierAccrualLines(220000)).toEqual([{ account: 1790, amount: 220000 }, { account: 4730, amount: -220000 }]);
    expect(supplierSettlementLines(220000, 55000, 220000, 'credit')).toEqual([{ account: 2440, amount: 275000 }, { account: 2641, amount: -55000 }, { account: 1790, amount: -220000 }]);
    expect(supplierSettlementLines(250000, 62500, 220000, 'bank')).toEqual([{ account: 1930, amount: 312500 }, { account: 2641, amount: -62500 }, { account: 1790, amount: -220000 }, { account: 4730, amount: -30000 }]);
  });
});
