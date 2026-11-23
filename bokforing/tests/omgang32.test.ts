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
