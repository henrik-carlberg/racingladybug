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

import { goodsRcError, goodsRcWarning } from '@/lib/goods-rc';
describe('Omvänd skattskyldighet för varor', () => {
  it('gränser och varning', () => {
    expect(goodsRcError({ category: 'electronics', net: 9999999, buyerIsCompany: true, buyerCountry: 'SE' })).toMatch(/100\s000/);
    expect(goodsRcError({ category: 'electronics', net: 10000000, buyerIsCompany: true, buyerCountry: '' })).toBeNull();
    expect(goodsRcError({ category: 'scrap', net: 100, buyerIsCompany: false, buyerCountry: 'SE' })).toMatch(/företag/);
    expect(goodsRcWarning({ rcKind: '', buyerIsCompany: true, net: 20000000, lines: [{ description: 'Mobiltelefoner' }] })).toMatch(/mobiltelefoner/);
    expect(goodsRcWarning({ rcKind: '', buyerIsCompany: true, net: 5000, lines: [{ description: 'Kopparskrot' }] })).toMatch(/metaller/);
    expect(goodsRcWarning({ rcKind: 'goods', buyerIsCompany: true, net: 20000000, lines: [{ description: 'Mobiltelefoner' }] })).toBeNull();
  });
});

import { deduction } from '@/lib/garnishment';
import { payrollBookingLines } from '@/lib/payroll';
describe('Löneutmätning', () => {
  it('förbehållsbelopp och konto 2750', () => {
    expect(deduction({ netPay: 3000000, monthly: 500000, reserved: 2000000 })).toBe(500000);
    expect(deduction({ netPay: 2200000, monthly: 500000, reserved: 2000000 })).toBe(200000);
    expect(deduction({ netPay: 1500000, monthly: 500000, reserved: 2000000 })).toBe(0);
    const calc = { grossCash: 4000000, benefits: 0, tax: 1000000, employerFee: 1256800, netDeductions: 500000, reimbursements: 0, netPay: 2500000 } as never;
    const lines = payrollBookingLines([{ calc, items: [{ type: 'net_deduction', description: 'x', amount: 500000, code: 'garnishment' }] }]);
    expect(lines.find((l) => l.account === 2750)?.credit).toBe(500000);
    expect(lines.find((l) => l.account === 1610)).toBeUndefined();
  });
});

import { earnedDays, finalPay } from '@/lib/final-pay';
describe('Slutlön', () => {
  it('lön, semesterersättning och förskottssemester', () => {
    const r = finalPay({ monthly: 4000000, end: '2026-11-15', unusedDays: 5, savedDays: 2, earnedDays: 10, advanceDays: 3, rule: 'same', ownResignation: true });
    expect(r.salary).toBe(2000000);
    expect(r.vacation).toBe(3420400);
    expect(r.advance).toBe(552000);
    expect(finalPay({ monthly: 4000000, end: '2026-11-30', unusedDays: 0, savedDays: 0, earnedDays: 0, advanceDays: 3, rule: 'same', ownResignation: false })).toMatchObject({ salary: 4000000, vacation: 0, advance: 0 });
    expect(earnedDays({ end: '2026-06-30', start: null, perYear: 25 })).toBe(12.4);
  });
});
