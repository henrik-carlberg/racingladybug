import { describe, expect, it } from 'vitest';
import { economics, forecastHours, progress, timelinePos } from '@/modules/projekt/calc';

describe('projekt', () => {
  it('lönsamhet med intern tidskostnad', () => {
    const e = economics({ revenue: 2000000, externalCost: 100000, minutes: 360, internalRate: 50000, budgetHours: 40, budgetRevenue: 6000000, budgetCost: 0 });
    expect(e.internalCost).toBe(300000);
    expect(e.result).toBe(1600000);
    expect(e.margin).toBe(80);
    expect(e.hoursUsed).toBe(6);
    expect(e.hoursPct).toBe(15);
    expect(e.revenuePct).toBe(33.3);
    expect(e.costPct).toBe(20); // 4 000 kr av 40 h × 500 kr
  });
  it('färdiggrad viktad med uppskattning', () => {
    expect(progress([{ status: 'done', estimate_minutes: 480 }, { status: 'todo', estimate_minutes: 1440 }, { status: 'doing', estimate_minutes: 480 }])).toBe(20);
    expect(progress([{ status: 'done', estimate_minutes: 0 }, { status: 'todo', estimate_minutes: 0 }])).toBe(50);
    expect(progress([])).toBe(0);
  });
  it('prognos och tidslinje', () => {
    expect(forecastHours(6, 20)).toBe(30);
    expect(forecastHours(6, 0)).toBeNull();
    expect(timelinePos('2026-01-01', '2026-12-31', '2026-07-02')).toBeCloseTo(50, 0);
    expect(timelinePos('2026-01-01', '2026-12-31', '2027-03-01')).toBe(100);
  });
});
