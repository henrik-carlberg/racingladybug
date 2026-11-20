import { describe, expect, it } from 'vitest';
import { confirmedLossLines, recoveryLines, reserveProposal, vatShare } from '@/lib/bad-debts';

describe('Kundförluster', () => {
  const inv = [{ account: 1510, amount: 1250000 }, { account: 3001, amount: -1000000 }, { account: 2611, amount: -250000 }];
  it('konstaterad förlust sätter ned momsen i proportion till det som återstår', () => {
    expect(confirmedLossLines(inv, 1250000)).toEqual([{ account: 6351, amount: 1000000 }, { account: 2611, amount: 250000 }, { account: 1510, amount: -1250000 }]);
    expect(vatShare(inv, 625000)).toMatchObject({ total: 125000, net: 500000 });
    expect(recoveryLines(inv, 250000, 1930)).toEqual([{ account: 1930, amount: 250000 }, { account: 6351, amount: -200000 }, { account: 2611, amount: -50000 }]);
    // Omvänd skattskyldighet: ingen moms att sätta ned
    expect(confirmedLossLines([{ account: 1510, amount: 1000000 }, { account: 3231, amount: -1000000 }], 1000000)).toEqual([{ account: 6351, amount: 1000000 }, { account: 1510, amount: -1000000 }]);
  });
  it('reserv för befarade förluster exklusive moms, ändring mot befintlig reserv', () => {
    const c = [{ id: 1, number: 1, customer: 'A', due: '2026-03-01', remaining: 500000, net: 400000, collection: false },
      { id: 2, number: 2, customer: 'B', due: '2026-12-01', remaining: 125000, net: 100000, collection: true },
      { id: 3, number: 3, customer: 'C', due: '2026-12-01', remaining: 125000, net: 100000, collection: false }];
    const r = reserveProposal(c, '2026-12-31', 150000);
    expect(r.doubtful.map((d) => d.id)).toEqual([1, 2]);
    expect(r).toMatchObject({ target: 500000, change: 350000 });
    expect(r.lines).toEqual([{ account: 6352, amount: 350000 }, { account: 1519, amount: -350000 }]);
    expect(reserveProposal([], '2026-12-31', 150000).lines).toEqual([{ account: 6352, amount: -150000 }, { account: 1519, amount: 150000 }]);
  });
});

import { controlBalance, deadlines, distribution, equityFromBalances, parseAdjustments, warning } from '@/lib/capital-control';
describe('Kontrollbalansräkning', () => {
  it('eget kapital, obeskattade reserver efter skatt och kapitalbrist', () => {
    const b = new Map([[2081, -2500000], [2091, 1000000], [2110, -500000], [5010, 1000000], [1930, 1000000]]);
    const e = equityFromBalances(b);
    expect(e).toMatchObject({ shareCapital: 2500000, equity: 500000, untaxed: 500000, result: -1000000 });
    const c = controlBalance({ ...e, adjustments: [{ label: 'Övervärde', amount: 300000 }] });
    expect(c).toMatchObject({ reserves: 397000, equity: 1197000, half: 1250000, deficit: true, restored: false });
    expect(warning(b)).not.toBeNull();
    expect(deadlines('2026-03-31').second).toBe('2026-11-30');
    expect(parseAdjustments('Fastighet; 150 000\nLager: -20000,50')).toEqual([{ label: 'Fastighet', amount: 15000000 }, { label: 'Lager', amount: -2000050 }]);
    expect(distribution(1000001, [{ name: 'A', pct: 60 }, { name: 'B', pct: 40 }]).map((x) => x.amount)).toEqual([600001, 400000]);
  });
});

import { accounts, position, saleLines, saleResult, taxSummary, writedown } from '@/lib/securities';
describe('Värdepapper', () => {
  it('genomsnittsmetoden, försäljning och lägsta värdets princip', () => {
    const p = position([{ kind: 'buy', date: '2026-01-01', quantity: 100, amount: 2000000, fee: 5000 }, { kind: 'buy', date: '2026-02-01', quantity: 100, amount: 3000000, fee: 0 }]);
    expect(p).toMatchObject({ quantity: 200, cost: 5005000 });
    const r = saleResult(p, 50, 1500000, 0);
    expect(r).toEqual({ cost: 1251250, net: 1500000, gain: 248750 });
    expect(saleLines(accounts('listed', 'current'), r, 1930)).toEqual([{ account: 1930, amount: 1500000 }, { account: 1810, amount: -1251250 }, { account: 8350, amount: -248750 }]);
    expect(() => saleResult(p, 201, 1, 0)).toThrow();
    expect(writedown({ holding: 'current', cost: 3753750, market: 3000000, current: 0, permanent: false })).toEqual({ target: 753750, change: 753750 });
    expect(writedown({ holding: 'fixed', cost: 100, market: 50, current: 0, permanent: false }).target).toBe(0);
    expect(writedown({ holding: 'current', cost: 100, market: 200, current: 30, permanent: false }).change).toBe(-30);
    expect(accounts('crypto', 'current').asset).toBe(1880);
  });
  it('skatt: näringsbetingat, kvittning av förluster och schablonintäkt på fonder', () => {
    const t = taxSummary([
      { id: 1, name: 'Dotter', kind: 'unlisted', businessRelated: true, dividends: 1000000, gains: 0, writedowns: 0, fundValueStart: 0 },
      { id: 2, name: 'Aktie', kind: 'listed', businessRelated: false, dividends: 0, gains: -300000, writedowns: 0, fundValueStart: 0 },
      { id: 3, name: 'Fond', kind: 'fund', businessRelated: false, dividends: 0, gains: 100000, writedowns: 0, fundValueStart: 10000000 },
      { id: 4, name: 'BTC', kind: 'crypto', businessRelated: false, dividends: 0, gains: -50000, writedowns: 20000, fundValueStart: 0 },
    ]);
    expect(t).toEqual({ exemptIncome: 1000000, nonDeductible: 220000, standardIncome: 40000, lossNotDeductible: 200000, taxableAdjustment: -740000 });
  });
});
