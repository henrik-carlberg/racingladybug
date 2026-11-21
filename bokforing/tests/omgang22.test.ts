import { describe, expect, it } from 'vitest';
import { assess, settleLines, unregistered } from '@/lib/owner-loans';

describe('Låneförbudet', () => {
  it('förbjudna och tillåtna lån', () => {
    expect(assess({ relation: 'owner', purpose: 'private', amount: 100, repaid: 0 }, true)).toMatchObject({ prohibited: true, taxedAsSalary: true, outstanding: 100 });
    expect(assess({ relation: 'owner', purpose: 'private', amount: 100, repaid: 100 }, true)).toMatchObject({ prohibited: false });
    expect(assess({ relation: 'related_company', purpose: 'business', amount: 100, repaid: 0 }, true).prohibited).toBe(false);
    expect(assess({ relation: 'related_company', purpose: 'private', amount: 100, repaid: 0 }, true)).toMatchObject({ prohibited: true, taxedAsSalary: false });
    expect(assess({ relation: 'group_company', purpose: 'private', amount: 100, repaid: 0 }, true).prohibited).toBe(false);
    expect(assess({ relation: 'board', purpose: 'private', amount: 100, repaid: 0 }, false)).toMatchObject({ prohibited: true, taxedAsSalary: false });
    expect(settleLines('dividend', 50)).toEqual([{ account: 2898, amount: 50 }, { account: 1685, amount: -50 }]);
    expect(unregistered(100, 30)).toBe(70);
  });
});

import { saleLines, taxGain } from '@/lib/property-sale';
describe('Försäljning av fastighet', () => {
  it('bokförd vinst och skattepliktig vinst med återföring', () => {
    const s = saleLines(600000000, 10000000, { building: 400000000, buildingDep: 8000000, land: 100000000, improvement: 0, improvementDep: 0 });
    expect(s).toMatchObject({ bookValue: 492000000, result: 98000000 });
    expect(s.lines.reduce((a, l) => a + l.amount, 0)).toBe(0);
    expect(s.lines.at(-1)).toEqual({ account: 3973, amount: -98000000 });
    expect(saleLines(100, 0, { building: 300, buildingDep: 0, land: 0, improvement: 0, improvementDep: 0 }).lines.at(-1)).toEqual({ account: 7973, amount: 200 });
    expect(taxGain({ price: 600000000, costs: 10000000, acquisition: 500000000, improvements: 0, taxDepreciation: 32000000 })).toEqual({ adjustedBasis: 468000000, gain: 122000000, recaptured: 32000000, capital: 90000000 });
  });
});

import { damageLines, deadline, maxFund, useLines } from '@/lib/replacement-fund';
describe('Ersättningsfond', () => {
  it('skada, fond och ianspråktagande', () => {
    expect(damageLines({ bookValue: 6000000, assetAccount: 1220, compensation: 9000000, receivedTo: 1930 })).toEqual([{ account: 1930, amount: 9000000 }, { account: 3994, amount: -9000000 }, { account: 7970, amount: 6000000 }, { account: 1220, amount: -6000000 }]);
    expect(maxFund(9000000, 0)).toBe(9000000);
    expect(deadline(2026)).toBe('2029-12-31');
    expect(useLines(100, 'inventarier')).toEqual([{ account: 2160, amount: 100 }, { account: 2150, amount: -100 }]);
    expect(useLines(100, 'byggnad')[1].account).toBe(8860);
  });
});
