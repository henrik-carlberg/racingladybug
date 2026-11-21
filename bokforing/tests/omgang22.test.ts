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

import { assess as assessFee, invoiceLines, period } from '@/lib/board-fees';
describe('Styrelsearvoden', () => {
  it('lön eller faktura, F-skatt och skatteavdrag', () => {
    expect(assessFee({ mode: 'invoice', recipient: 'company', fSkatt: true, inBusiness: false }).treatment).toBe('salary');
    const fs = assessFee({ mode: 'invoice', recipient: 'company', fSkatt: true, inBusiness: true });
    expect(invoiceLines(2000000, fs, 0)).toMatchObject({ tax: 0, fee: 0, net: 2000000 });
    const no = assessFee({ mode: 'invoice', recipient: 'person', fSkatt: false, inBusiness: true });
    expect(invoiceLines(2000000, no, 0)).toMatchObject({ tax: 600000, fee: 628400, net: 1400000 });
    expect(invoiceLines(50000, no, 0).fee).toBe(0);
    expect(invoiceLines(2000000, no, 0).lines.reduce((a, l) => a + l.amount, 0)).toBe(0);
    expect(period('2026-05-15')).toBe('2026/27');
  });
});

import { checks, needsDocumentation } from '@/lib/transfer-pricing';
describe('Internprissättning', () => {
  const base = { type: 'loan' as const, crossBorder: true, amount: 1000000000, method: 'cup' as const, markupPct: null, ratePct: 2, rangeMin: 3, rangeMax: 6, documented: false, lowValue: false };
  it('dokumentationskrav och marknadsmässighet', () => {
    expect(needsDocumentation({ crossBorder: true, amount: 499999999, type: 'goods' })).toBe(false);
    expect(needsDocumentation({ crossBorder: true, amount: 100, type: 'license' })).toBe(true);
    expect(needsDocumentation({ crossBorder: false, amount: 1e12, type: 'goods' })).toBe(false);
    expect(checks(base).map((w) => w.level)).toEqual(['error', 'error']);
    expect(checks({ ...base, ratePct: 4, documented: true })).toEqual([]);
    expect(checks({ ...base, type: 'services', method: 'cost_plus', ratePct: null, markupPct: 0, rangeMin: null, rangeMax: null, documented: true }).some((w) => w.text.includes('utan påslag'))).toBe(true);
    expect(checks({ ...base, type: 'services', method: 'cost_plus', ratePct: null, markupPct: 3, rangeMin: null, rangeMax: null, documented: true, lowValue: true })[0].text).toMatch(/5 % påslag/);
  });
});
