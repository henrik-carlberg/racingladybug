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

import { build, nextMonths, seasonality, shiftYm, weighted } from '@/lib/sales-forecast';
describe('Försäljningsprognos', () => {
  it('månader, viktning och säsong', () => {
    expect(nextMonths('2026-11', 3)).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(shiftYm('2026-01', -12)).toBe('2025-01');
    expect(weighted(100000, 40)).toBe(40000);
    const h = new Map<string, number>(); for (let m = 1; m <= 12; m++) h.set(`2025-${String(m).padStart(2, '0')}`, m === 12 ? 300 : 100);
    const s = seasonality(h);
    expect(s[11]).toBeCloseTo(2.57, 2); expect(s[0]).toBeCloseTo(0.86, 2);
    expect(seasonality(new Map([['2025-01', 100]]))).toEqual(Array(12).fill(1));
  });
  it('prognos mot budget', () => {
    const rows = build({ months: ['2026-12', '2027-01'], contracts: new Map([['2026-12', 1000]]), pipeline: new Map([['2027-01', 500]]), baselineMonthly: 200, season: Array(12).fill(1), budget: new Map([['2026-12', 1500]]) });
    expect(rows[0]).toMatchObject({ total: 1200, budget: 1500, diff: -300 });
    expect(rows[1]).toMatchObject({ total: 700, budget: null, diff: null });
  });
});

import { earningsValue, isGift, multipleValue, saleTax, substanceValue } from '@/lib/valuation';
describe('Företagsvärdering och ägarskifte', () => {
  it('tre värderingsmetoder', () => {
    expect(substanceValue({ equity: 1000000, untaxedReserves: 1000000, surplus: 0 })).toBe(1794000);
    expect(earningsValue(30000000, 15)).toBe(158800000);
    expect(earningsValue(-100, 15)).toBe(0);
    expect(multipleValue(30000000, 5, 42500000)).toBe(192500000);
  });
  it('skatt vid försäljning av kvalificerade andelar och gåva', () => {
    const t = saleTax({ price: 100000000, costBasis: 2500000, limit: 32240000, ibb: 80600, qualified: true });
    expect(t).toMatchObject({ gain: 97500000, within: 32240000, service: 65260000, above: 0, tax: 40383200 });
    const big = saleTax({ price: 2000000000, costBasis: 0, limit: 0, ibb: 80600, qualified: true });
    expect(big.service).toBe(806000000); expect(big.above).toBe(2000000000 - 806000000);
    expect(saleTax({ price: 1000000, costBasis: 0, limit: 0, ibb: 80600, qualified: false }).tax).toBe(250000);
    expect(isGift(2500000, 2500000)).toBe(true); expect(isGift(2500001, 2500000)).toBe(false);
  });
});
