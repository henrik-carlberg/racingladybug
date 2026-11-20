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

import { calculatePayslip } from '@/lib/payroll';
import { buildAgiXml } from '@/lib/agi';
import { validate } from '@/lib/special-tax';
describe('Expertskatt och SINK', () => {
  const items = [{ type: 'salary' as const, description: 'Lön', amount: 4000000 }, { type: 'benefit' as const, description: 'Bil', amount: 400000 }];
  it('expertskatt: en fjärdedel skattefri, även för avgifterna', () => {
    const c = calculatePayslip(items, { mode: 'percent', percent: 30 }, 1985, '2026-11-25', null, 'expert');
    expect(c).toMatchObject({ taxKind: 'expert', exemptCash: 1000000, exemptBenefits: 100000, taxable: 3300000 });
    expect(c.employerFee).toBe(Math.round(3300000 * 0.3142));
  });
  it('SINK: 25 % i hela kronor och ruta 274', () => {
    const c = calculatePayslip(items, { mode: 'table', rows: [] }, 1985, '2026-11-25', null, 'sink');
    expect(c).toMatchObject({ taxKind: 'sink', tax: 1100000, taxable: 4400000 });
    const xml = buildAgiXml({ period: '2026-11', employer: { agId: '165560000000', contactName: 'A', contactPhone: '1', contactEmail: 'a@b.se' }, totalEmployerFees: 0, totalTax: 1100000,
      individuals: [{ personalNumber: '198112189876', specNumber: 1, grossCash: 4000000, benefits: 400000, tax: 0, sinkTax: 1100000 }] });
    expect(xml).toContain('<agd:AvdrSkattSINK faltkod="274">11000</agd:AvdrSkattSINK>');
    expect(xml).not.toContain('faltkod="001"');
  });
  it('giltighet', () => {
    expect(validate('expert', '2026-01-01', '2030-12-31')).toBeNull();
    expect(validate('expert', '2026-01-01', '2031-01-01')).toMatch(/högst 5 år/);
    expect(validate('sink', '2026-01-01', '2027-01-31')).toMatch(/ett inkomstår/);
  });
});

import { companyChecks, exercise, grantChecks, vestedOn } from '@/lib/kpo';
describe('Kvalificerade personaloptioner', () => {
  it('villkor för bolag och tilldelning', () => {
    expect(companyChecks({ employees: 30, turnover: 1e9, balance: 1e9, startedYear: 2020, year: 2026, excluded: false }).every((c) => c.ok)).toBe(true);
    expect(companyChecks({ employees: 300, turnover: 1e9, balance: 1e9, startedYear: 2010, year: 2026, excluded: false }).filter((c) => !c.ok)).toHaveLength(2);
    expect(grantChecks({ hoursPerWeek: 20, options: 10, shareValue: 1000, premium: 0 }, 0).filter((c) => !c.ok).map((c) => c.text)).toEqual([expect.stringMatching(/30 timmar/)]);
    expect(grantChecks({ hoursPerWeek: 40, options: 1, shareValue: 7500000001, premium: 0 }, 0).some((c) => !c.ok)).toBe(true);
  });
  it('utnyttjande efter tre år är kvalificerat, annars förmån', () => {
    expect(vestedOn('2026-03-15')).toBe('2029-03-15');
    expect(exercise({ grantedOn: '2026-03-15', date: '2029-03-15', count: 100, strike: 1000, marketPrice: 5000, employedThrough: true })).toMatchObject({ qualified: true, benefit: 0 });
    expect(exercise({ grantedOn: '2026-03-15', date: '2028-01-01', count: 100, strike: 1000, marketPrice: 5000, employedThrough: true })).toMatchObject({ qualified: false, benefit: 400000 });
    expect(exercise({ grantedOn: '2026-03-15', date: '2030-01-01', count: 100, strike: 1000, marketPrice: 5000, employedThrough: false }).qualified).toBe(false);
  });
});
