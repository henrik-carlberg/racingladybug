import { describe, expect, it } from 'vitest';
import { bidMargin, capStatus, expiring, winRate } from '@/lib/tenders';

describe('Anbud och ramavtal', () => {
  it('vinstprocent, tak och utgång', () => {
    expect(winRate(['won', 'lost', 'draft', 'withdrawn'])).toBe(50);
    expect(winRate(['draft'])).toBeNull();
    expect(bidMargin(100000000, 80000000)).toBe(20);
    expect(capStatus(8500000, 10000000, 80)).toMatchObject({ pct: 85, level: 'warn', left: 1500000 });
    expect(capStatus(10500000, 10000000, 80)).toMatchObject({ level: 'over', left: -500000 });
    expect(capStatus(100, 10000000, 80).level).toBe('ok');
    expect(expiring('2026-12-23', '2026-11-23')).toBe(true);
    expect(expiring('2027-06-01', '2026-11-23')).toBe(false);
  });
});
