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
