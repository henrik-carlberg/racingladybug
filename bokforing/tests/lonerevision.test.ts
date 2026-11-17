import { describe, expect, it } from 'vitest';
import { legalSex, payGroups, raiseByPercent, raisePercent, retroAmount, summarize } from '@/modules/lonerevision/calc';

describe('lönerevision', () => {
  it('höjning i procent avrundas till hela kronor', () => {
    expect(raiseByPercent(3500000, 3)).toBe(3605000);
    expect(raiseByPercent(3333300, 2.5)).toBe(3416600); // 34 166,325 → 34 166
    expect(raisePercent(3500000, 3640000)).toBe(4);
  });
  it('budget och fördelning', () => {
    const s = summarize([{ current: 3500000, next: 3640000 }, { current: 4200000, next: 4200000 }], 3);
    expect(s.payroll).toBe(7700000);
    expect(s.budget).toBe(231000);
    expect(s.allocated).toBe(140000);
    expect(s.left).toBe(91000);
    expect(s.raised).toBe(1);
    expect(s.minPercent).toBe(0);
    expect(s.maxPercent).toBe(4);
  });
  it('retroaktiv lön för utbetalda månader, första månaden proportionellt', () => {
    expect(retroAmount(140000, '2026-04-01', ['2026-03', '2026-04', '2026-05'])).toBe(280000);
    expect(retroAmount(300000, '2026-04-16', ['2026-04', '2026-05'])).toBe(150000 + 300000);
    expect(retroAmount(-1000, '2026-04-01', ['2026-04'])).toBe(0);
    expect(retroAmount(1000, '2026-06-01', ['2026-05'])).toBe(0);
  });
  it('juridiskt kön ur personnummer', () => {
    expect(legalSex('198112189876')).toBe('M');
    expect(legalSex('19811218-9886')).toBe('K');
    expect(legalSex('x')).toBeNull();
  });
  it('lönekartläggning per grupp', () => {
    const g = payGroups([
      { group: 'Utvecklare', sex: 'K', salary: 4000000 }, { group: 'Utvecklare', sex: 'K', salary: 4400000 },
      { group: 'Utvecklare', sex: 'M', salary: 4500000 }, { group: 'Utvecklare', sex: 'M', salary: 4300000 },
      { group: 'Ekonom', sex: 'K', salary: 3800000 },
    ]);
    expect(g[0]).toEqual({ group: 'Ekonom', women: 1, men: 0, avgWomen: 3800000, avgMen: null, ratio: null });
    expect(g[1].ratio).toBe(95.5);
  });
});
