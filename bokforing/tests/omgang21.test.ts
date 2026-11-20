import { describe, expect, it } from 'vitest';
import { rollForward, yearBase } from '@/lib/interest-limit';

describe('Ränteavdragsbegränsning', () => {
  const y = (year: number, cost: number, taxable: number, income = 0, dep = 0) => ({ year, start: `${year}-01-01`, end: `${year}-12-31`, interestIncome: income, interestCost: cost, taxable, depreciation: dep });
  it('EBITDA-regeln, förenklingsregeln och sparat räntenetto', () => {
    expect(yearBase(y(2025, 600000000, -100000000, 0, 50000000))).toEqual({ netCost: 600000000, ebitda: 550000000, room: 165000000 });
    const r = rollForward([y(2025, 600000000, -100000000), y(2026, 100000000, 1900000000)]);
    expect(r[0]).toMatchObject({ rule: 'ebitda', deductible: 150000000, nonDeductible: 450000000, savedOut: 450000000 });
    expect(r[1]).toMatchObject({ rule: 'simplification', deductible: 100000000, usedSaved: 0, savedOut: 450000000 });
    const z = rollForward([y(2025, 600000000, -100000000), y(2026, 100000000, 1900000000)], 0);
    expect(z[1]).toMatchObject({ rule: 'ebitda', deductible: 100000000, usedSaved: 450000000, savedOut: 0 });
    const old = rollForward([y(2018, 600000000, -100000000), y(2025, 0, 0)]);
    expect(old[1]).toMatchObject({ expired: 450000000, savedOut: 0 });
  });
});
