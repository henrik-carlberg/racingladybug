import { describe, expect, it } from 'vitest';
import { brfKeyFigures, feesByShare, fundLines, maxPledgeFee, maxTransferFee, shareSum } from '@/lib/brf';

describe('Bostadsrättsföreningar', () => {
  it('avgift efter andelstal summerar exakt', () => {
    const apts = [{ id: 1, share: 0.3, area: 60 }, { id: 2, share: 0.45, area: 90 }, { id: 3, share: 0.25, area: 50 }];
    const f = feesByShare(apts, 36000000, 12);
    expect(f.reduce((s, x) => s + x.fee, 0)).toBe(3000000);
    expect(f.find((x) => x.id === 1)!.fee).toBe(900000);
    expect(feesByShare(apts, 36000000, 4).reduce((s, x) => s + x.fee, 0)).toBe(9000000);
    expect(shareSum(apts).ok).toBe(true);
    expect(shareSum([{ share: 0.5 }]).ok).toBe(false);
  });
  it('överlåtelse- och pantsättningsavgift av prisbasbeloppet', () => {
    expect(maxTransferFee(2026)).toBe(148000);
    expect(maxPledgeFee(2026)).toBe(59200);
    expect(maxTransferFee(2099)).toBe(148000);
  });
  it('fond för yttre underhåll', () => {
    expect(fundLines({ kind: 'reserve', amount: 100 })).toEqual([{ account: 2068, amount: 100 }, { account: 2086, amount: -100 }]);
    expect(fundLines({ kind: 'use', amount: 100 })).toEqual([{ account: 2086, amount: 100 }, { account: 2068, amount: -100 }]);
  });
  it('nyckeltal', () => {
    const k = brfKeyFigures({ fees: 72000000, revenue: 80000000, result: 5000000, depreciation: 10000000, plannedMaintenance: 0, debt: 1000000000, energy: 12000000, brArea: 1000, totalArea: 1200 });
    const v = Object.fromEntries(k.map((r) => [r.key, r.value]));
    expect(v).toEqual({ fee_per_kvm: 720, fee_share: 90, debt_per_kvm: 8333, debt_per_br_kvm: 10000, saving_per_kvm: 125, interest_sensitivity: 13.9, energy_per_kvm: 100 });
  });
});

import { creditDecision, onTimeFactor, riskClass, suggestedLimit } from '@/lib/credit';
describe('Kreditkontroll', () => {
  it('riskklass', () => {
    expect(riskClass({ score: 85, remarks: 0, status: 'active', recommendedLimit: 1 }, null)).toBe('low');
    expect(riskClass({ score: 50, remarks: 0, status: 'active', recommendedLimit: 1 }, null)).toBe('medium');
    expect(riskClass({ score: 85, remarks: 1, status: 'active', recommendedLimit: 1 }, null)).toBe('high');
    expect(riskClass({ score: 85, remarks: 0, status: 'bankruptcy', recommendedLimit: 1 }, null)).toBe('stop');
    expect(riskClass({ score: 85, remarks: 0, status: 'active', recommendedLimit: 1 }, { count: 5, avgDelay: 40, onTimeShare: 0 })).toBe('high');
    expect(riskClass({ score: 50, remarks: 0, status: 'active', recommendedLimit: 1 }, { count: 5, avgDelay: 0, onTimeShare: 1 })).toBe('low');
    expect(riskClass(null, null)).toBe('medium');
  });
  it('kreditgräns', () => {
    expect(creditDecision({ limit: 1000000, open: 600000, amount: 300000, risk: 'low', policy: 'block' })).toMatchObject({ ok: true, block: false, utilization: 90 });
    const d = creditDecision({ limit: 1000000, open: 800000, amount: 300000, risk: 'low', policy: 'block' });
    expect(d.block).toBe(true);
    expect(d.reasons[0].replace(/\s/g, ' ')).toContain('10 000 kr');
    expect(creditDecision({ limit: null, open: 0, amount: 1, risk: 'stop', policy: 'warn' })).toMatchObject({ ok: false, block: false });
    expect(suggestedLimit({ score: 50, remarks: 0, status: 'active', recommendedLimit: 10000000 }, 'medium')).toBe(7000000);
    expect(onTimeFactor('high')).toBeLessThan(onTimeFactor('low'));
  });
});

import { financialPaymentLines, maturity, operationalLines, presentValue, schedule, suggestClass } from '@/lib/leasing';
describe('Leasing', () => {
  it('operationell: personbil halva momsen', () => {
    const l = operationalLines({ fee: 400000, vatRate: 25, kind: 'car', bank: 1930 });
    expect(l).toEqual([{ account: 5615, amount: 450000 }, { account: 2641, amount: 50000 }, { account: 1930, amount: -500000 }]);
    expect(operationalLines({ fee: 100000, vatRate: 25, kind: 'machine', bank: 1930 })).toEqual([{ account: 5220, amount: 100000 }, { account: 2641, amount: 25000 }, { account: 1930, amount: -125000 }]);
  });
  it('nuvärde, betalningsplan och klassning', () => {
    expect(presentValue({ fee: 100000, months: 12, ratePct: 0, residual: 0 })).toBe(1200000);
    const pv = presentValue({ fee: 200000, months: 36, ratePct: 6, residual: 1000000 });
    const s = schedule({ fee: 200000, months: 36, ratePct: 6, residual: 1000000, start: '2026-01-15' });
    expect(s).toHaveLength(36);
    expect(s.reduce((t, r) => t + r.amortization, 0)).toBe(pv);
    expect(s[35].balance).toBe(0);
    expect(s[0].interest).toBeGreaterThan(s[34].interest);
    expect(s[35].fee).toBe(1200000);
    expect(suggestClass({ months: 48, lifeMonths: 60, pv, fairValue: null, transfer: false }).financial).toBe(true);
    expect(suggestClass({ months: 36, lifeMonths: 120, pv: 100, fairValue: 1000, transfer: false }).financial).toBe(false);
    const p = financialPaymentLines(s[0], { vatRate: 25, kind: 'machine', bank: 1930, fee: 200000 });
    expect(p.reduce((t, x) => t + x.amount, 0)).toBe(0);
  });
  it('förfallotider', () => {
    const m = maturity([{ fee: 100000, residual: 500000, start: '2026-01-01', months: 72 }], '2026-12-31');
    expect(m.within1).toBe(1200000);
    expect(m.oneTo5).toBe(4800000 + 500000);
    expect(m.over5).toBe(0);
    expect(m.total).toBe(6500000);
    expect(maturity([{ fee: 100000, residual: 0, start: '2026-01-01', months: 120 }], '2026-06-30').over5).toBe(100000 * (114 - 60));
  });
});

import { invoiceCommission, rateFor, selfInvoiceVat, targetBonus, tierBonus } from '@/lib/commission';
describe('Provisioner', () => {
  const rules = [
    { scope: 'account' as const, customerId: null, account: 3041, ratePct: 10, sellerId: null },
    { scope: 'customer' as const, customerId: 7, account: null, ratePct: 2, sellerId: null },
    { scope: 'customer' as const, customerId: 7, account: null, ratePct: 4, sellerId: 1 },
  ];
  it('mest specifika regeln', () => {
    expect(rateFor(rules, { sellerId: 1, customerId: 7, account: 3041, baseRate: 5 })).toBe(4);
    expect(rateFor(rules, { sellerId: 2, customerId: 7, account: 3041, baseRate: 5 })).toBe(2);
    expect(rateFor(rules, { sellerId: 2, customerId: 8, account: 3041, baseRate: 5 })).toBe(10);
    expect(rateFor(rules, { sellerId: 2, customerId: 8, account: 3001, baseRate: 5 })).toBe(5);
  });
  it('provision per rad och bonus', () => {
    expect(invoiceCommission({ netSek: 1000000, lines: [{ account: 3041, net: 500000 }, { account: 3001, net: 500000 }], sellerId: 2, customerId: 8, baseRate: 5, rules })).toBe(75000);
    expect(tierBonus([{ threshold: 10000000, ratePct: 2 }, { threshold: 20000000, ratePct: 3 }], 25000000)).toBe(200000 + 150000);
    expect(tierBonus([{ threshold: 10000000, ratePct: 2 }], 5000000)).toBe(0);
    expect(targetBonus({ target: 10000000, amount: 500000, basis: 10000000 })).toBe(500000);
    expect(targetBonus({ target: 10000000, amount: 500000, basis: 9999999 })).toBe(0);
    expect(selfInvoiceVat(100000, true)).toBe(25000);
  });
});
