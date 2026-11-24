import { describe, expect, it } from 'vitest';
import { dueCost, elapsed, periodLines, reclassLines, renewalDue, yearlyCost } from '@/lib/insurance-policies';

describe('Försäkringsöversikt', () => {
  it('periodisering, förnyelse och årskostnad', () => {
    expect(elapsed('2026-09-01', '2027-08-31', '2026-11-24')).toEqual({ months: 3, total: 12 });
    expect(elapsed('2026-09-15', '2027-09-14', '2026-08-01')).toEqual({ months: 0, total: 12 });
    expect(elapsed('2026-01-01', '2026-12-31', '2028-01-01').months).toBe(12);
    expect(dueCost(1200000, '2026-09-01', '2027-08-31', '2026-11-24')).toBe(300000);
    expect(reclassLines(1200000)).toEqual([{ account: 1790, amount: 1200000 }, { account: 6310, amount: -1200000 }]);
    expect(periodLines(300000)).toEqual([{ account: 6310, amount: 300000 }, { account: 1790, amount: -300000 }]);
    expect(periodLines(0)).toEqual([]);
    expect(renewalDue('2026-12-24', '2026-11-24')).toBe(30);
    expect(renewalDue('2027-03-01', '2026-11-24')).toBeNull();
    expect(renewalDue('2026-11-01', '2026-11-24')).toBeNull();
    expect(yearlyCost(600000, '2026-01-01', '2026-06-30')).toBe(1200000);
  });
});

import { cancelBy, looksRecurring, monthlyCost, nextRenewal, priceChange, unusedCost } from '@/lib/supplier-subscriptions';
describe('Leverantörsabonnemang', () => {
  it('förnyelse, uppsägning, prisändring och licenser', () => {
    expect(monthlyCost(1200000, 12)).toBe(100000);
    expect(nextRenewal('2026-01-31', 1, '2026-03-05')).toBe('2026-03-31');
    expect(nextRenewal('2026-01-31', 1, '2026-02-10')).toBe('2026-02-28');
    expect(nextRenewal('2027-01-01', 12, '2026-11-24')).toBe('2027-01-01');
    expect(cancelBy('2026-12-24', 30, '2026-11-14')).toEqual({ by: '2026-11-24', left: 10, soon: true, missed: false });
    expect(cancelBy('2026-12-14', 30, '2026-11-24').missed).toBe(true);
    expect(priceChange(100000, 110000)).toBe(10);
    expect(priceChange(100000, 101000)).toBeNull();
    expect(priceChange(100000, null)).toBeNull();
    expect(unusedCost(100000, 1, 10, 7)).toBe(30000);
    expect(unusedCost(100000, 1, 10, 10)).toBe(0);
    expect(looksRecurring(['2026-09', '2026-10', '2026-10'])).toBe(false);
    expect(looksRecurring(['2026-09', '2026-10', '2026-11'])).toBe(true);
  });
});

import { ageMonths, replaceDue, returnStatus, warrantyEnding } from '@/lib/it-equipment';
describe('IT-utrustning', () => {
  it('ålder, garanti och återlämning', () => {
    expect(ageMonths('2023-11-25', '2026-11-24')).toBe(35);
    expect(replaceDue('2023-11-24', '2026-11-24')).toBe(true);
    expect(replaceDue('2023-11-25', '2026-11-24')).toBe(false);
    expect(replaceDue(null, '2026-11-24')).toBe(false);
    expect(warrantyEnding('2026-12-14', '2026-11-24')).toBe(20);
    expect(warrantyEnding('2026-11-01', '2026-11-24')).toBeNull();
    expect(returnStatus([{ status: 'in_use' }, { status: 'in_stock' }], '2026-11-30', '2026-12-01')).toEqual({ out: 1, overdue: true, done: false });
    expect(returnStatus([{ status: 'lost' }], '2026-11-30', '2026-12-01').done).toBe(true);
  });
});

import { deductibleCost, looksLikePenalty, penaltyLines, reclassLines as penReclass } from '@/lib/penalties';
describe('Sanktionsavgifter', () => {
  it('känner igen avgifter och konton', () => {
    expect(looksLikePenalty('Förseningsavgift Bolagsverket')).toBe(true);
    expect(looksLikePenalty('Felparkeringsavgift Stockholm')).toBe(true);
    expect(looksLikePenalty('Parkeringsbot')).toBe(true);
    expect(looksLikePenalty('Vite enligt föreläggande')).toBe(true);
    expect(looksLikePenalty('Parkeringsavgift Q-Park')).toBe(false);
    expect(looksLikePenalty('Robotdammsugare')).toBe(false);
    expect(looksLikePenalty('Invite AB konsult')).toBe(false);
    expect(deductibleCost(6900, [6992, 8423])).toBe(true);
    expect(deductibleCost(6992, [6992, 8423])).toBe(false);
    expect(deductibleCost(1930, [6992])).toBe(false);
    expect(deductibleCost(8910, [6992])).toBe(false);
    expect(penaltyLines(1000000, 6992, 1630)).toEqual([{ account: 6992, amount: 1000000 }, { account: 1630, amount: -1000000 }]);
    expect(penReclass(500000, 6900)).toEqual([{ account: 6992, amount: 500000 }, { account: 6900, amount: -500000 }]);
  });
});

import { costAccount, renewal as ipRenewal, renewedUntil, treatment } from '@/lib/ip-rights';
describe('Immateriella rättigheter', () => {
  it('förnyelse och kostnadsföring eller aktivering', () => {
    expect(renewedUntil('2016-03-01', 'trademark')).toBe('2026-03-01');
    expect(renewedUntil('2026-01-31', 'domain')).toBe('2027-01-31');
    expect(ipRenewal('2027-03-04', 'trademark', '2026-11-24')).toMatchObject({ days: 100, due: true, opensOn: '2026-09-04', grace: '2027-09-04' });
    expect(ipRenewal('2027-03-04', 'domain', '2026-11-24')!.due).toBe(false);
    expect(ipRenewal('2026-11-01', 'patent', '2026-11-24')!.overdue).toBe(true);
    expect(treatment('acquisition', 15000000, 2026)).toBe('capitalized');
    expect(treatment('acquisition', 2000000, 2026)).toBe('expensed');
    expect(treatment('application', 15000000, 2026)).toBe('expensed');
    expect(costAccount('patent', 'acquisition', 'capitalized')).toBe(1030);
    expect(costAccount('trademark', 'acquisition', 'capitalized')).toBe(1050);
    expect(costAccount('domain', 'renewal', 'expensed')).toBe(6540);
    expect(costAccount('patent', 'legal', 'expensed')).toBe(6550);
  });
});

