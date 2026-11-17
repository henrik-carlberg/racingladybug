import { describe, expect, it } from 'vitest';
import { addMonths, invoiceDate, mrr, noticeDeadline, period, renewUntil } from '@/modules/avtal/calc';
import { aging, bucket, lateInterest, nextAction } from '@/modules/reskontra/calc';
import { categoryOf, occurrences, result, weekly } from '@/modules/likviditet/calc';
import { allowance, approvalEntries, mileage, vatPart } from '@/modules/utlagg/calc';

describe('avtal', () => {
  it('perioder och månader', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(period('2026-12-01', 3)).toEqual({ start: '2026-12-01', end: '2027-02-28', next: '2027-03-01' });
    expect(invoiceDate('2026-12-01', 1, true)).toBe('2026-12-01');
    expect(invoiceDate('2026-12-01', 1, false)).toBe('2027-01-01');
  });
  it('uppsägning, förlängning och MRR', () => {
    expect(noticeDeadline('2027-12-31', 3)).toBe('2027-09-30');
    expect(renewUntil('2026-12-31', 12, '2027-01-01')).toBe('2027-12-31');
    expect(mrr(1200000, 12)).toBe(100000);
  });
});

describe('reskontra', () => {
  it('åldersanalys', () => {
    expect(bucket('2026-11-20', '2026-11-17')).toBe('current');
    expect(bucket('2026-10-01', '2026-11-17')).toBe('d60');
    expect(aging([{ due_date: '2026-11-10', amount: 100 }, { due_date: '2026-06-01', amount: 50 }], '2026-11-17')).toEqual({ current: 0, d30: 100, d60: 0, d90: 0, older: 50, total: 150 });
  });
  it('dröjsmålsränta 10 % per år', () => {
    expect(lateInterest(10000000, '2026-10-18', '2026-11-17', 10)).toBe(82200); // 100 000 kr × 10 % × 30/365 = 821,92 → 822
    expect(lateInterest(10000000, '2026-11-20', '2026-11-17', 10)).toBe(0);
  });
  it('nästa steg', () => {
    const s = { first_days: 7, second_days: 21, collection_days: 35 };
    expect(nextAction(3, [], false, s)).toBeNull();
    expect(nextAction(8, [], false, s)).toBe('reminder1');
    expect(nextAction(22, [1], false, s)).toBe('reminder2');
    expect(nextAction(40, [1, 2], false, s)).toBe('collection');
    expect(nextAction(40, [1, 2], true, s)).toBeNull();
  });
});

describe('likviditet och budget', () => {
  it('kategorier och resultat', () => {
    expect(categoryOf(3001)).toBe('revenue');
    expect(categoryOf(7010)).toBe('personnel');
    expect(categoryOf(1930)).toBeNull();
    expect(result({ revenue: 1000, goods: 200, external: 100, personnel: 300 })).toBe(400);
  });
  it('återkommande poster', () => {
    expect(occurrences('2026-01-31', 'monthly', null, '2026-11-01', '2027-01-31')).toEqual(['2026-11-30', '2026-12-31', '2027-01-31']);
    expect(occurrences('2026-12-05', 'none', null, '2026-11-17', '2027-02-01')).toEqual(['2026-12-05']);
    expect(occurrences('2026-03-01', 'quarterly', '2026-12-31', '2026-11-17', '2027-12-31')).toEqual(['2026-12-01']);
  });
  it('veckor med löpande saldo', () => {
    const w = weekly(1000, [{ date: '2026-11-01', amount: 500, kind: 'k', text: 'förfallen' }, { date: '2026-11-25', amount: -2000, kind: 'l', text: 'lev' }], '2026-11-17', 3);
    expect(w.map((x) => [x.start, x.balance])).toEqual([['2026-11-16', 1500], ['2026-11-23', -500], ['2026-11-30', -500]]);
  });
});

describe('utlägg', () => {
  it('milersättning, traktamente och moms', () => {
    expect(mileage(124, 2500)).toBe(31000);
    expect(allowance(2, 1, 2, { full: 30000, half: 15000, night: 15000 })).toBe(105000);
    expect(vatPart(12500, 25)).toBe(2500);
    expect(vatPart(11200, 12)).toBe(1200);
  });
  it('kontering mot skuld till anställda', () => {
    expect(approvalEntries([
      { kind: 'receipt', amount: 12500, vat: 2500, account: 6110, description: '' },
      { kind: 'mileage', amount: 31000, vat: 0, account: 7331, description: '' },
    ], 2820)).toEqual([{ account: 6110, amount: 10000 }, { account: 7331, amount: 31000 }, { account: 2641, amount: 2500 }, { account: 2820, amount: -43500 }]);
  });
});
