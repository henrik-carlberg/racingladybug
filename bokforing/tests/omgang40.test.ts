import { describe, expect, it } from 'vitest';
import { annuity, evaluate, financing, flows, irr, npv, payback } from '@/lib/investment';

describe('Investeringskalkyl', () => {
  it('nuvärde, internränta, återbetalning och finansiering', () => {
    const c = { investment: 100000000, lifeYears: 5, annualIn: 40000000, annualOut: 10000000, growthPct: 0, residual: 10000000, ratePct: 8 };
    expect(flows(c)).toEqual([30000000, 30000000, 30000000, 30000000, 40000000]);
    expect(npv(8, c.investment, flows(c))).toBe(26587133);
    expect(payback(c.investment, flows(c))).toBe(3.3);
    const r = irr(c.investment, flows(c))!;
    expect(npv(r, c.investment, flows(c))).toBeLessThan(10000); expect(r).toBeGreaterThan(15);
    expect(annuity(10000000, 0, 5)).toBe(2000000);
    const e = evaluate(c);
    expect(e.sensitivity.revenueMinus20).toBeLessThan(e.npv); expect(e.sensitivity.ratePlus2).toBeLessThan(e.npv);
    const f = financing(c, 5, 2200000);
    expect(f.cash).toBe(100000000 - Math.round(10000000 / Math.pow(1.08, 5)));
    expect(['cash', 'loan', 'lease']).toContain(f.best);
    expect(payback(100, [10, 10])).toBeNull();
  });
});

import { breached, dso, fmtValue, overBudget } from '@/lib/kpi-alerts';
describe('Nyckeltalslarm', () => {
  it('gränser och mått', () => {
    expect(breached(25, 'below', 30)).toBe(true);
    expect(breached(null, 'below', 30)).toBe(false);
    expect(breached(50, 'above', 45)).toBe(true);
    expect(dso(10000000, 73000000)).toBe(50);
    expect(dso(100, 0)).toBeNull();
    expect(overBudget(1100000, 1000000)).toBe(10);
    expect(overBudget(1, 0)).toBeNull();
    expect(fmtValue('cash', 50000)).toContain('kr');
  });
});

import { packageHtml, period, variance } from '@/lib/board-package';
describe('Styrelsepaket', () => {
  it('period, avvikelse och escaping', () => {
    expect(period('month', '2026-11-24')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(period('quarter', '2026-11-24')).toEqual({ from: '2026-08-01', to: '2026-10-31' });
    expect(period('month', '2026-01-10')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(period('quarter', '2026-02-10')).toEqual({ from: '2025-11-01', to: '2026-01-31' });
    expect(variance(110, 100)).toEqual({ diff: 10, pct: 10 });
    const html = packageHtml({ company: '<A&B>', from: '2026-10-01', to: '2026-10-31', result: { revenue: 0, costs: 0, result: 0, budgetRevenue: 0, budgetCosts: 0, budgetResult: 0 }, cash: 0, kpis: [], alerts: [], decisions: [], control: { missing: 0, deviations: [] }, risks: [] }, String, '<b>');
    expect(html).toContain('&lt;A&amp;B&gt;'); expect(html).not.toContain('<b>Styrelse'); expect(html).toContain('&lt;b&gt;');
  });
});

import { exposure, overLimit } from '@/lib/fx-exposure';
describe('Valutaexponering', () => {
  it('netto, säkring och känslighet', () => {
    const [e] = exposure([{ kind: 'receivable', currency: 'EUR', amountCurrency: 100000, bookedSek: 1150000 }, { kind: 'payable', currency: 'EUR', amountCurrency: 20000, bookedSek: 230000 }], [{ currency: 'EUR', direction: 'sell', amount: 400 }], {});
    expect(e).toMatchObject({ net: 80000, hedge: 40000, unhedged: 40000, rate: 11.5, hedgedShare: 50, unhedgedSek: 460000 });
    expect(e.sensitivity.find((s) => s.pct === 10)!.effect).toBe(46000);
    const [u] = exposure([{ kind: 'bank', currency: 'USD', amountCurrency: 10000, bookedSek: 100000 }], [], { USD: 11 });
    expect(u.unhedgedSek).toBe(110000);
    expect(overLimit(-600000, 500000)).toBe(true);
    expect(overLimit(400000, null)).toBe(false);
  });
});

import { categoryOf, change, pareto, priceIncrease } from '@/lib/spend';
describe('Inköpsanalys', () => {
  it('kategori, pareto och prishöjning', () => {
    expect(categoryOf(4010)).toBe('Varor och material');
    expect(categoryOf(6110)).toBe('Kontor och förbrukning');
    expect(categoryOf(7210)).toBe('Övrigt');
    expect(change(110, 100)).toBe(10);
    const p = pareto([{ spend: 20 }, { spend: 76 }, { spend: 4 }]);
    expect(p.map((x) => x.top)).toEqual([true, true, false]);
    expect(p[0]).toMatchObject({ share: 76, cumulative: 76 });
    expect(priceIncrease([5000000, 5000000, 5000000, 5600000])).toBe(12);
    expect(priceIncrease([5000000, 5000000])).toBeNull();
    expect(priceIncrease([1000, 5000, 9000, 9000])).toBeNull();
  });
});

