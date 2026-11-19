import { describe, expect, it } from 'vitest';
import { compareScenarios, defaultParams, k10, scenario } from '@/lib/k10';

const base = { share: 100, costBasis: 2_500_000, savedSpace: 0, wages: 0, ownSalary: 0, dividends: 0 };

describe('3:12 och K10', () => {
  it('förenklingsregeln 2025 är 2,75 inkomstbasbelopp (209 550 kr)', () => {
    const r = k10(defaultParams(2025), base);
    expect(r.rule).toBe('förenkling');
    expect(r.limit).toBe(20_955_000);
  });
  it('grundbelopp 2026 är 4 inkomstbasbelopp (322 400 kr) fördelat efter ägarandel', () => {
    expect(k10(defaultParams(2026), base).limit).toBe(32_240_000);
    expect(k10(defaultParams(2026), { ...base, share: 50 }).limit).toBe(16_120_000);
  });
  it('lönebaserat utrymme 2026: 50 % av lönerna över 8 inkomstbasbelopp', () => {
    const r = k10(defaultParams(2026), { ...base, wages: 100_000_000 });
    expect(r.wageBased).toBe(Math.round(0.5 * (100_000_000 - 8 * 8_060_000)));
    expect(r.wageRequirementMet).toBeNull();
  });
  it('huvudregeln 2025 kräver att lönekravet är uppfyllt', () => {
    const noSalary = k10(defaultParams(2025), { ...base, wages: 200_000_000 });
    expect(noSalary.wageRequirementMet).toBe(false);
    expect(noSalary.rule).toBe('förenkling');
    const salary = k10(defaultParams(2025), { ...base, wages: 200_000_000, ownSalary: 80_000_000 });
    expect(salary.wageRequirementMet).toBe(true);
    expect(salary.rule).toBe('huvudregel');
    expect(salary.wageBased).toBe(100_000_000);
  });
  it('utdelning inom och över gränsbeloppet, sparat utrymme', () => {
    const r = k10(defaultParams(2026), { ...base, savedSpace: 1_000_000, dividends: 40_000_000 });
    expect(r.limit).toBe(33_240_000);
    expect(r.aboveLimit).toBe(40_000_000 - 33_240_000);
    expect(r.savedNext).toBe(0);
    expect(k10(defaultParams(2026), { ...base, dividends: 10_000_000 }).savedNext).toBe(22_240_000);
    expect(k10(defaultParams(2026), { ...base, share: 3, wages: 200_000_000 }).wageBased).toBe(0);
  });
});

describe('lön eller utdelning', () => {
  const p = { profit: 100_000_000, limit: 32_240_000, municipalTax: 32, stateThreshold: 64_300_000 };
  it('allt som utdelning inom gränsbeloppet', () => {
    const s = scenario({ ...p, profit: 10_000_000 }, 0);
    expect(s.corporateTax).toBe(2_060_000);
    expect(s.dividend).toBe(7_940_000);
    expect(s.net).toBe(Math.round(7_940_000 * 0.8));
  });
  it('bästa fördelningen är minst lika bra som de andra', () => {
    const c = compareScenarios(p);
    expect(c.best.net).toBeGreaterThanOrEqual(c.allSalary.net);
    expect(c.best.net).toBeGreaterThanOrEqual(c.allDividend.net);
    expect(c.allSalary.dividend).toBe(0);
    expect(c.allSalary.employerFee + c.allSalary.salary).toBeLessThanOrEqual(100_000_000);
  });
});
