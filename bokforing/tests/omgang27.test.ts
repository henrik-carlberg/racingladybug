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
