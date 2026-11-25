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

import { checkVoucher, euCompare } from '@/lib/vat-recon';
describe('Momsavstämning', () => {
  const keys = (l: { account: number; amount: number }[]) => checkVoucher(l).map((i) => i.key);
  it('rätt moms ger inga avvikelser', () => {
    expect(keys([{ account: 1510, amount: -1250000 }, { account: 3001, amount: 1000000 }, { account: 2611, amount: 250000 }])).toEqual([]);
    expect(keys([{ account: 1510, amount: -1120000 }, { account: 3002, amount: 1000000 }, { account: 2621, amount: 120000 }])).toEqual([]);
  });
  it('fel momssats, saknad moms och moms på momsfri försäljning', () => {
    expect(keys([{ account: 1510, amount: -1120000 }, { account: 3001, amount: 1000000 }, { account: 2611, amount: 120000 }])).toContain('rate');
    expect(keys([{ account: 1510, amount: -1120000 }, { account: 3001, amount: 1000000 }, { account: 2621, amount: 120000 }])).toContain('rate');
    expect(keys([{ account: 1510, amount: -1000000 }, { account: 3001, amount: 1000000 }])).toEqual(['no_vat']);
    expect(keys([{ account: 1510, amount: -1250000 }, { account: 3308, amount: 1000000 }, { account: 2611, amount: 250000 }])).toContain('exempt_vat');
  });
  it('omvänd skattskyldighet', () => {
    expect(keys([{ account: 4535, amount: -1000000 }, { account: 2440, amount: 1000000 }])).toEqual(['rc_out']);
    expect(keys([{ account: 4535, amount: -1000000 }, { account: 4598, amount: 1000000 }, { account: 2614, amount: 250000 }, { account: 2645, amount: -250000 }])).toEqual([]);
    expect(keys([{ account: 4535, amount: -1000000 }, { account: 4598, amount: 1000000 }, { account: 2614, amount: 250000 }, { account: 1930, amount: -250000 }])).toEqual(['rc_in']);
    expect(keys([{ account: 4535, amount: -1000000 }, { account: 4598, amount: 1000000 }, { account: 2614, amount: 120000 }, { account: 2645, amount: -120000 }])).toEqual(['rc_rate']);
  });
  it('EU-försäljning mot periodisk sammanställning', () => {
    expect(euCompare({ goods: 1000000, services: 500000 }, { goods: 10000, services: 5000 }).every((r) => r.ok)).toBe(true);
    expect(euCompare({ goods: 0, services: 1500000 }, { goods: 0, services: 5000 })[1]).toMatchObject({ ok: false, diff: 10000 });
  });
});
