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
