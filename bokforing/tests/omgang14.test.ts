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
