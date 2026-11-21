import { describe, expect, it } from 'vitest';
import { settle, settleLines } from '@/lib/vmb';
import { vatReport } from '@/lib/vat';

describe('Vinstmarginalbeskattning', () => {
  it('marginal, överföring och ruta 07', () => {
    expect(settle({ sales: 800000, purchases: 1000000, carriedIn: 0 })).toEqual({ margin: -200000, vat: 0, base: 0, carryOut: 200000 });
    expect(settle({ sales: 1950000, purchases: 500000, carriedIn: 200000 })).toEqual({ margin: 1250000, vat: 250000, base: 1000000, carryOut: 0 });
    const l = settleLines(250000, 1000000);
    const sums = new Map(l.map((x) => [x.account, x.amount]));
    const r = vatReport(sums);
    expect(r.boxes.find((b) => b.box === '07')?.amount).toBe(1000000);
    expect(r.boxes.find((b) => b.box === '10')?.amount).toBe(250000);
  });
});
