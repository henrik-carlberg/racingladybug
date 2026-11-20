import { describe, expect, it } from 'vitest';
import { exitDates, fulfilment, grantLines, insatsLines, proportional, refundLines, yieldOf } from '@/lib/coop';

describe('Ekonomisk förening och stiftelse', () => {
  it('utträde: avgång vid räkenskapsårets slut minst en månad efter uppsägningen, utbetalning sex månader senare', () => {
    expect(exitDates('2025-03-10', ['2024-12-31', '2025-12-31'])).toEqual({ leavesOn: '2025-12-31', payableFrom: '2026-06-30' });
    expect(exitDates('2025-12-15', ['2025-12-31', '2026-12-31'])).toEqual({ leavesOn: '2026-12-31', payableFrom: '2027-06-30' });
    expect(exitDates('2025-05-20', ['2025-08-31', '2026-08-31'])).toEqual({ leavesOn: '2025-08-31', payableFrom: '2026-02-28' });
    expect(exitDates('2030-02-01', [])).toEqual({ leavesOn: '2030-12-31', payableFrom: '2031-06-30' });
  });
  it('återbäring fördelas efter köp och summerar på öret', () => {
    const r = proportional(100000, [{ id: 1, base: 1 }, { id: 2, base: 1 }, { id: 3, base: 1 }]);
    expect(r.map((x) => x.amount).reduce((a, b) => a + b)).toBe(100000);
    expect(r.map((x) => x.amount)).toEqual([33334, 33333, 33333]);
    expect(proportional(1000, [{ base: 300 }, { base: 100 }, { base: -50 }]).map((x) => x.amount)).toEqual([750, 250, 0]);
    expect(proportional(1000, [{ base: 0 }]).map((x) => x.amount)).toEqual([0]);
    expect(refundLines(500)).toEqual([{ account: 3739, amount: 500 }, { account: 2891, amount: -500 }]);
    expect(insatsLines('repaid', 200)).toEqual([{ account: 2083, amount: 200 }, { account: 1930, amount: -200 }]);
  });
  it('stiftelsens avkastning och fullföljdskravet över fem år', () => {
    const y = yieldOf(new Map([[8310, -100000], [3010, -20000], [6570, 10000], [6993, 60000], [1930, 5]]));
    expect(y).toEqual({ income: 120000, admin: 10000, yield: 110000, purpose: 60000 });
    const f = fulfilment([{ year: 2021, yield: 100, purpose: 0 }, { year: 2022, yield: 100, purpose: 0 }, { year: 2023, yield: 100, purpose: 0 }, { year: 2024, yield: 100, purpose: 0 }, { year: 2025, yield: 100, purpose: 400 }, { year: 2026, yield: 100, purpose: 0 }]);
    expect(f[4]).toMatchObject({ windowYield: 500, required: 400, shortfall: 0, pct: 80 });
    expect(f[5]).toMatchObject({ windowYears: 5, windowYield: 500, windowPurpose: 400, shortfall: 0 });
    expect(f[0]).toMatchObject({ required: 80, shortfall: 80 });
    expect(grantLines('pay', 10, 1940)).toEqual([{ account: 2895, amount: 10 }, { account: 1940, amount: -10 }]);
  });
});
