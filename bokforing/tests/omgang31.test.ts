import { describe, expect, it } from 'vitest';
import { reasonStats, returnable, skuOf } from '@/lib/returns';

describe('Returer', () => {
  it('antal, artikel och statistik', () => {
    expect(returnable(4, 2.5)).toBe(1.5);
    expect(returnable(1, 3)).toBe(0);
    expect(skuOf('A-1 Kaffebryggare', ['B-2', 'a-1'])).toBe('a-1');
    expect(skuOf('Konsulttimmar', ['A-1'])).toBeNull();
    const s = reasonStats([
      { case_id: 1, reason: 'defect', status: 'credited', value: 100000, product: 'A-1 X', qty: 2 },
      { case_id: 2, reason: 'defect', status: 'replaced', value: 50000, product: 'A-1 X', qty: 1 },
      { case_id: 3, reason: 'regret', status: 'rejected', value: 50000, product: 'A-1 X', qty: 0 },
    ]);
    expect(s.reasons[0]).toEqual({ reason: 'defect', label: 'Fel på varan', cases: 2, value: 150000, rejected: 0 });
    expect(s.reasons[1]).toMatchObject({ reason: 'regret', cases: 1, value: 0, rejected: 50000 });
    expect(s.products).toEqual([{ product: 'A-1 X', qty: 3, cases: 3 }]);
  });
});

import { bookingLines, computeReturn, dueDate, parseRate, paymentLines } from '@/lib/excise';
describe('Punktskatter', () => {
  it('skattesats, beräkning och kontering', () => {
    expect(parseRate('1,5')).toBe(150);
    expect(parseRate('0,439')).toBe(43.9);
    expect(parseRate('0')).toBeNull();
    const r = computeReturn([{ id: 1, name: 'Kemikalieskatt', unit: 'kg', rate: 150, cost_account: 6900, delivered: 5, manual: 20 }, { id: 2, name: 'Energiskatt', unit: 'kWh', rate: 43.9, cost_account: 6900, delivered: 0, manual: 0 }]);
    expect(r.lines).toHaveLength(1);
    expect(r.total).toBe(3800);
    expect(bookingLines(r.lines)).toEqual([{ account: 6900, amount: 3800 }, { account: 2660, amount: -3800 }]);
    expect(paymentLines(3800)).toEqual([{ account: 2660, amount: 3800 }, { account: 1630, amount: -3800 }]);
    expect(dueDate('2026-12')).toBe('2027-01-26');
  });
});

import { assessmentLines, compensation, paymentLines as claimPayment, scrapLines, stockLossLines } from '@/lib/damage-claims';
describe('Försäkringsskador', () => {
  it('ersättning och kontering', () => {
    expect(compensation(4000000, 500000)).toBe(3500000);
    expect(compensation(300000, 500000)).toBe(0);
    expect(scrapLines(5000000, 1000000, { asset: 1220, accDep: 1229 })).toEqual([{ account: 1220, amount: -5000000 }, { account: 1229, amount: 1000000 }, { account: 7973, amount: 4000000 }]);
    expect(stockLossLines(50000)).toEqual([{ account: 4960, amount: 50000 }, { account: 1460, amount: -50000 }]);
    expect(stockLossLines(0)).toEqual([]);
    expect(assessmentLines(3500000)).toEqual([{ account: 1689, amount: 3500000 }, { account: 3994, amount: -3500000 }]);
    expect(claimPayment(3500000)).toEqual([{ account: 1930, amount: 3500000 }, { account: 1689, amount: -3500000 }]);
  });
});
