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
