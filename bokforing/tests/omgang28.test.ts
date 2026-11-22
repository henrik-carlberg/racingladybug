import { describe, expect, it } from 'vitest';
import { allowanceDetailed, excess, mileage, BENEFIT_CAR_RATE } from '@/modules/utlagg/calc';

describe('Traktamente på djupet', () => {
  it('måltider, utrikes och långvarig förrättning', () => {
    expect(allowanceDetailed({ full: 3, half: 0, nights: 2, normal: 30000, halfRate: 15000, night: 15000, meals: { breakfast: 2, lunch: 1, dinner: 0 } }).amount).toBe(97500);
    expect(allowanceDetailed({ full: 1, half: 0, nights: 0, normal: 30000, night: 15000, meals: { breakfast: 1, lunch: 1, dinner: 1 } }).amount).toBe(3000);
    expect(allowanceDetailed({ full: 2, half: 0, nights: 1, normal: 100000, night: 50000, meals: { breakfast: 0, lunch: 0, dinner: 0 }, longTerm: '3m' }).amount).toBe(190000);
    expect(excess(250000, 190000)).toBe(60000);
    expect(mileage(100, BENEFIT_CAR_RATE.el)).toBe(9500);
  });
});

import { countLines, running } from '@/lib/cashbook';
describe('Kassabok', () => {
  it('saldo och inventering', () => {
    const r = running(0, [{ date: '2026-11-01', amount: 500000 }, { date: '2026-11-03', amount: -450000 }, { date: '2026-11-02', amount: -120000 }]);
    expect(r.map((x) => x.balance)).toEqual([500000, 380000, -70000]);
    expect(r[2].negative).toBe(true);
    expect(countLines(28000, 30000)).toEqual({ diff: -2000, lines: [{ account: 1910, amount: -2000 }, { account: 3740, amount: 2000 }] });
    expect(countLines(100, 100).lines).toEqual([]);
  });
});
