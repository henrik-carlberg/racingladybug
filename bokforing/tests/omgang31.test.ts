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
