import { describe, expect, it } from 'vitest';
import { adjustment, disposalAdjustment } from '@/lib/vat-advanced';

describe('Jämkning', () => {
  it('20 år och slutjämkning', () => {
    const nb = { vat: 40000000, kind: 'nybyggnad' as const, completedYear: 2025, origPct: 50 };
    expect(adjustment(nb, 2026, 100).amount).toBe(1000000);
    expect(disposalAdjustment(nb, 2026, true)).toEqual({ amount: 19000000, remaining: 19 });
    expect(disposalAdjustment({ vat: 5000000, kind: 'inventarie', completedYear: 2025, origPct: 100 }, 2026, false)).toEqual({ amount: -4000000, remaining: 4 });
    expect(disposalAdjustment({ vat: 5000000, kind: 'inventarie', completedYear: 2020, origPct: 100 }, 2026, false).remaining).toBe(0);
  });
});
