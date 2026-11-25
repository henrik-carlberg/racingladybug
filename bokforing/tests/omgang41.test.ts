import { describe, expect, it } from 'vitest';
import { contribution, lateCost, marginPct, simulate } from '@/lib/profitability';

describe('Kund- och produktlönsamhet', () => {
  const r = { revenue: 10000000, goods: 4000000, time: 3000000, losses: 500000, late: 100000 };
  it('täckningsbidrag och täckningsgrad', () => {
    expect(contribution(r)).toBe(2400000);
    expect(marginPct(r)).toBe(24);
    expect(marginPct({ ...r, revenue: 0 })).toBeNull();
    expect(contribution({ ...r, time: 6000000 })).toBeLessThan(0);
  });
  it('räntekostnad för sen betalning', () => {
    expect(lateCost(3650000, 10, 10)).toBe(10000);
    expect(lateCost(3650000, 0, 10)).toBe(0);
    expect(lateCost(3650000, -5, 10)).toBe(0);
  });
  it('simulering av pris och betalningsvillkor', () => {
    const s = simulate(r, 10, 50);
    expect(s.revenue).toBe(11000000);
    expect(s.late).toBe(50000);
    expect(s.change).toBe(1050000);
    expect(simulate(r, 0, 200).late).toBe(0);
  });
});
