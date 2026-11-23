import { describe, expect, it } from 'vitest';
import { bidMargin, capStatus, expiring, winRate } from '@/lib/tenders';

describe('Anbud och ramavtal', () => {
  it('vinstprocent, tak och utgång', () => {
    expect(winRate(['won', 'lost', 'draft', 'withdrawn'])).toBe(50);
    expect(winRate(['draft'])).toBeNull();
    expect(bidMargin(100000000, 80000000)).toBe(20);
    expect(capStatus(8500000, 10000000, 80)).toMatchObject({ pct: 85, level: 'warn', left: 1500000 });
    expect(capStatus(10500000, 10000000, 80)).toMatchObject({ level: 'over', left: -500000 });
    expect(capStatus(100, 10000000, 80).level).toBe('ok');
    expect(expiring('2026-12-23', '2026-11-23')).toBe(true);
    expect(expiring('2027-06-01', '2026-11-23')).toBe(false);
  });
});

import { impacts, project, type Item } from '@/lib/scenarios';
describe('Scenarioplanering', () => {
  it('projektion, kassa och påverkan', () => {
    const base = { revenue: Array(12).fill(10000000), costs: Array(12).fill(5000000), openingCash: 36000000 };
    expect(project(base, []).result).toBe(60000000);
    const items: Item[] = [{ kind: 'lost_customer', label: 'Kund', from_month: 1, amount: 2000000, pct: 0, years: 0 }, { kind: 'hire', label: 'Säljare', from_month: 4, amount: 4000000, pct: 0, years: 0 }];
    const p = project(base, items);
    expect(p.result).toBe(-11311200);
    expect(p).toMatchObject({ lowestCash: 24688800, lowestMonth: 12 });
    expect(impacts(base, items)[0]).toMatchObject({ label: 'Säljare', result: -47311200 });
    const inv = project(base, [{ kind: 'investment', label: 'Maskin', from_month: 1, amount: 12000000, pct: 0, years: 5 }]);
    expect(inv.result).toBe(60000000 - 2400000);
    expect(inv.closingCash).toBe(36000000 + 60000000 - 12000000);
    const loan = project(base, [{ kind: 'loan', label: 'Lån', from_month: 1, amount: 12000000, pct: 0, years: 1 }]);
    expect(loan.closingCash).toBe(36000000 + 60000000);
  });
});

import { eventResult, recognitionLines, refundLines, saleLines } from '@/lib/events';
describe('Evenemang', () => {
  it('biljetter, återbetalning och intäktsföring', () => {
    expect(saleLines(250000, 25)).toEqual([{ account: 1930, amount: 250000 }, { account: 2970, amount: -200000 }, { account: 2611, amount: -50000 }]);
    expect(refundLines(112000, 12)).toEqual([{ account: 2970, amount: 100000 }, { account: 2621, amount: 12000 }, { account: 1930, amount: -112000 }]);
    expect(recognitionLines([{ net: 200000, vat_rate: 25 }, { net: 100000, vat_rate: 12 }], 1000000)).toEqual([{ account: 2970, amount: 1300000 }, { account: 3001, amount: -1200000 }, { account: 3002, amount: -100000 }]);
    expect(eventResult({ tickets: 300000, sponsors: 1000000, costs: 800000, budget: 700000 })).toEqual({ revenue: 1300000, costs: 800000, result: 500000, vsBudget: 100000 });
  });
});
