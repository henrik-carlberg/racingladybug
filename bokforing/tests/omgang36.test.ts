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

//@@NEXT@@
