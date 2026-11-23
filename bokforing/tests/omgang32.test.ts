import { describe, expect, it } from 'vitest';
import { entryLines, nextBalance, reconcile } from '@/lib/client-funds';

describe('Klientmedel', () => {
  it('kontering, saldo och avstämning', () => {
    const o = { bank: 1940, liability: 2890 };
    expect(entryLines('deposit', 100, o)).toEqual([{ account: 1940, amount: 100 }, { account: 2890, amount: -100 }]);
    expect(entryLines('fee', 100, o)).toEqual([{ account: 2890, amount: 100 }, { account: 1940, amount: -100 }]);
    expect(nextBalance(1000, 'payout', 400)).toBe(600);
    expect(() => nextBalance(1000, 'payout', 1001)).toThrow();
    expect(reconcile({ clients: 500, bank: 500, liability: 500 }).ok).toBe(true);
    expect(reconcile({ clients: 500, bank: 400, liability: 500 })).toMatchObject({ ok: false, bankDiff: -100 });
  });
});

import { balances, forfeitLines } from '@/lib/packaging';
describe('Returemballage', () => {
  it('saldo per kund och förverkan', () => {
    const b = balances([
      { customer: 'A', type: 'Pall', kind: 'out', quantity: 10, deposit: 15000, date: '2026-01-01' },
      { customer: 'A', type: 'Pall', kind: 'return', quantity: 4, deposit: 15000, date: '2026-02-01' },
      { customer: 'B', type: 'Pall', kind: 'out', quantity: 2, deposit: 15000, date: '2026-10-01' },
      { customer: 'B', type: 'Pall', kind: 'forfeit', quantity: 2, deposit: 15000, date: '2026-11-01' },
    ], '2026-11-23');
    expect(b).toEqual([{ customer: 'A', type: 'Pall', qty: 6, value: 90000, lastOut: '2026-01-01', lastReturn: '2026-02-01', stale: true }]);
    expect(forfeitLines(90000)).toEqual([{ account: 2899, amount: 90000 }, { account: 3990, amount: -90000 }]);
  });
});

import { billingPeriod, rentFor, utilization } from '@/lib/rental';
describe('Uthyrning', () => {
  it('hyra, period och beläggning', () => {
    const r = { day: 100000, week: 500000, month: 1500000 };
    expect(rentFor(3, r)).toBe(300000);
    expect(rentFor(6, r)).toBe(500000);
    expect(rentFor(10, r)).toBe(800000);
    expect(rentFor(25, r)).toBe(1500000);
    expect(rentFor(31, r)).toBe(1600000);
    expect(rentFor(4, { day: 100000, week: null, month: null })).toBe(400000);
    expect(billingPeriod({ start: '2026-11-01', invoicedUntil: null, returnedOn: null, until: '2026-11-10' })).toEqual({ from: '2026-11-01', to: '2026-11-10', days: 10 });
    expect(billingPeriod({ start: '2026-11-01', invoicedUntil: '2026-11-10', returnedOn: '2026-11-15', until: '2026-11-30' })).toEqual({ from: '2026-11-11', to: '2026-11-15', days: 5 });
    expect(billingPeriod({ start: '2026-11-01', invoicedUntil: '2026-11-10', returnedOn: null, until: '2026-11-10' })).toBeNull();
    expect(utilization([{ start: '2026-11-01', end: '2026-11-05' }], '2026-11-01', '2026-11-10').pct).toBe(50);
  });
});

import { adjustmentLines, liabilityFor, pointStatus, pointsFor, redemptionValue } from '@/lib/loyalty';
describe('Lojalitetsprogram', () => {
  it('poäng, skuld och förfall', () => {
    expect(pointsFor(150500, 10)).toBe(150);
    expect(pointsFor(-100, 10)).toBe(0);
    expect(redemptionValue(200, { point_value: 10 })).toBe(2000);
    expect(liabilityFor(550, { point_value: 10, redemption_rate: 80 })).toBe(4400);
    expect(pointStatus([{ date: '2024-01-01', kind: 'earn', points: 100 }, { date: '2026-01-01', kind: 'earn', points: 50 }, { date: '2026-02-01', kind: 'redeem', points: 30 }], '2024-11-23'))
      .toEqual({ balance: 120, expiring: 70 });
    expect(adjustmentLines(-1600)).toEqual([{ account: 3790, amount: -1600 }, { account: 2970, amount: 1600 }]);
  });
});
