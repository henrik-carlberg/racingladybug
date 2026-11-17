import { describe, expect, it } from 'vitest';
import { analysis, forecast, weighted, type DealLite } from '@/modules/crm/calc';

const d = (o: Partial<DealLite>): DealLite => ({ value: 0, probability: 0, kind: 'open', expected_close: null, created: '2026-01-01', closed_at: null, lost_reason: '', owner: 'Anna', ...o });

describe('säljpipeline', () => {
  it('viktat värde', () => {
    expect(weighted(12000000, 50)).toBe(6000000);
  });
  it('prognos per månad', () => {
    const f = forecast([
      d({ value: 1000000, probability: 50, expected_close: '2026-12-15' }),
      d({ value: 500000, probability: 10, expected_close: '2026-10-01' }), // passerat → innevarande månad
      d({ value: 200000, probability: 100, kind: 'won', expected_close: '2026-12-01' }), // vunnen räknas inte
      d({ value: 300000, probability: 25, expected_close: '2027-09-01' }), // utanför perioden
    ], '2026-11', 3);
    expect(f).toEqual([
      { month: '2026-11', value: 500000, weighted: 50000, count: 1 },
      { month: '2026-12', value: 1000000, weighted: 500000, count: 1 },
      { month: '2027-01', value: 0, weighted: 0, count: 0 },
    ]);
  });
  it('vinstandel, snittaffär, säljcykel och förlustorsaker', () => {
    const a = analysis([
      d({ kind: 'won', value: 1000000, created: '2026-01-01', closed_at: '2026-01-31' }),
      d({ kind: 'won', value: 3000000, created: '2026-02-01', closed_at: '2026-02-11', owner: 'Bo' }),
      d({ kind: 'lost', lost_reason: 'Pris' }), d({ kind: 'lost', lost_reason: 'Pris', owner: 'Bo' }), d({ kind: 'lost', lost_reason: '' }),
    ]);
    expect(a.winRate).toBe(40);
    expect(a.avgDeal).toBe(2000000);
    expect(a.avgCycleDays).toBe(20);
    expect(a.reasons).toEqual([{ reason: 'Pris', n: 2 }, { reason: 'Ej angiven', n: 1 }]);
    expect(a.owners[0]).toEqual({ owner: 'Bo', won: 1, lost: 1, value: 3000000, winRate: 50 });
  });
});
