import { describe, expect, it } from 'vitest';
import { decayed, HALF_LIFE_DAYS, rankByUsage, usagePath } from '@/lib/usage';

describe('usagePath', () => {
  it('räknar menysidor och åtgärder relativt bolaget', () => {
    expect(usagePath('/c/12')).toEqual({ cid: 12, path: '' });
    expect(usagePath('/c/12/fakturor/ny')).toEqual({ cid: 12, path: '/fakturor/ny' });
    expect(usagePath('/c/3/m/crm/pipeline')).toEqual({ cid: 3, path: '/m/crm/pipeline' });
  });
  it('räknar inte enskilda poster eller okända adresser', () => {
    expect(usagePath('/c/12/fakturor/345')).toBeNull();
    expect(usagePath('/konto')).toBeNull();
    expect(usagePath('/c/12/../x')).toBeNull();
    expect(usagePath('/c/12/a/b/c/d/e')).toBeNull();
    expect(usagePath('/c/12/Fakturor')).toBeNull();
  });
});

describe('decayed', () => {
  it('halveras efter halveringstiden', () => {
    expect(decayed(4, 0)).toBe(4);
    expect(decayed(4, HALF_LIFE_DAYS)).toBeCloseTo(2);
    expect(decayed(4, 2 * HALF_LIFE_DAYS)).toBeCloseTo(1);
  });
});

describe('rankByUsage', () => {
  it('mest använt först, annars ursprunglig ordning', () => {
    expect(rankByUsage(['a', 'b', 'c', 'd'], (x) => ({ c: 5, d: 2 } as Record<string, number>)[x] ?? 0)).toEqual(['c', 'd', 'a', 'b']);
    expect(rankByUsage(['a', 'b'], () => 0)).toEqual(['a', 'b']);
  });
});
