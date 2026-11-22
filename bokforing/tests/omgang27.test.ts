import { describe, expect, it } from 'vitest';
import { rcCostLines } from '@/lib/purchase-rc';
import { vatReport } from '@/lib/vat';

describe('Inköp med omvänd skattskyldighet', () => {
  it('konto, moms och rutor', () => {
    const r = rcCostLines([{ account: 5010, amount: 10000000 }], 'construction');
    expect(r.vat).toBe(2500000);
    expect(r.lines).toEqual([{ account: 4425, amount: 10000000 }, { account: 2647, amount: 2500000 }, { account: 2614, amount: -2500000 }]);
    const boxes = vatReport(new Map(r.lines.map((l) => [l.account, l.amount]))).boxes;
    const b = (k: string) => boxes.find((x) => x.box === k)?.amount;
    expect([b('24'), b('30'), b('48'), b('49')]).toEqual([10000000, 2500000, 2500000, 0]);
  });
});

import { invoiceLine, outlayError } from '@/lib/outlays';
describe('Utlägg för kund', () => {
  it('villkor och fakturarad', () => {
    expect(outlayError({ receiptInCustomerName: false, onBehalf: true })).toMatch(/vidarefakturering/);
    expect(outlayError({ receiptInCustomerName: true, onBehalf: true })).toBeNull();
    expect(invoiceLine({ description: 'Avgift', amount: 220000 })).toMatchObject({ vat_rate: 0, account: 1680, unit_price: 220000 });
  });
});

import { expireLines, redeemLines, saleLines } from '@/lib/gift-cards';
describe('Presentkort', () => {
  it('enfunktion och flerfunktion', () => {
    expect(saleLines({ kind: 'single', amount: 125000, rate: 25, payAccount: 1580 })).toEqual([{ account: 1580, amount: 125000 }, { account: 2421, amount: -100000 }, { account: 2611, amount: -25000 }]);
    expect(saleLines({ kind: 'multi', amount: 100000, rate: 25, payAccount: 1930 })).toEqual([{ account: 1930, amount: 100000 }, { account: 2421, amount: -100000 }]);
    expect(redeemLines({ kind: 'single', amount: 50000, rate: 25, face: 125000 })).toEqual([{ account: 2421, amount: 40000 }, { account: 3001, amount: -40000 }]);
    expect(redeemLines({ kind: 'multi', amount: 50000, rate: 25, face: 100000 })).toEqual([{ account: 2421, amount: 50000 }, { account: 3001, amount: -40000 }, { account: 2611, amount: -10000 }]);
    expect(expireLines({ kind: 'multi', balance: 100000, rate: 25 })).toEqual([{ account: 2421, amount: 100000 }, { account: 3990, amount: -100000 }]);
  });
});
