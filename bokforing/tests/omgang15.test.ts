import { describe, expect, it } from 'vitest';
import { capitalOf, carryLines, distribute, n3b, ownerLines, partnerAccounts, resultLines, validatePartners } from '@/lib/partnership';

const P = (n: number, sharePct: number, limited = false, contribution = 0) => ({ n, name: `D${n}`, sharePct, limited, contribution });
describe('Handels- och kommanditbolag', () => {
  it('konton och validering', () => {
    expect(partnerAccounts(2)).toEqual({ capital: 2020, withdrawals: 2023, contributions: 2028, result: 2029 });
    expect(() => partnerAccounts(5)).toThrow();
    expect(validatePartners('HB', [P(1, 50), P(2, 50)])).toBeNull();
    expect(validatePartners('HB', [P(1, 60), P(2, 50)])).toContain('100 %');
    expect(validatePartners('HB', [P(1, 100)])).toContain('minst två');
    expect(validatePartners('KB', [P(1, 50), P(2, 50)])).toContain('kommanditdelägare');
    expect(validatePartners('KB', [P(1, 70), P(2, 30, true)])).toBeNull();
  });
  it('resultatfördelning och bokslut', () => {
    expect(distribute(100001, [P(1, 33.33), P(2, 33.33), P(3, 33.34)]).reduce((s, d) => s + d.amount, 0)).toBe(100001);
    expect(resultLines(1000000, [P(1, 60), P(2, 40)])).toEqual([{ account: 8999, amount: 1000000 }, { account: 2019, amount: -600000 }, { account: 2029, amount: -400000 }]);
    const bal = new Map([[2013, 200000], [2018, -50000], [2019, -600000], [2029, -400000]]);
    const c = carryLines(bal, [P(1, 60), P(2, 40)]);
    expect(c.reduce((s, l) => s + l.amount, 0)).toBe(0);
    expect(c.find((l) => l.account === 2010)!.amount).toBe(-450000);
    expect(capitalOf(new Map([[2010, -1000000], [2013, 200000], [2019, -300000]]), 1)).toBe(1100000);
    expect(ownerLines({ n: 2, kind: 'withdrawal', amount: 100, bank: 1930 })).toEqual([{ account: 2023, amount: 100 }, { account: 1930, amount: -100 }]);
  });
  it('N3B med begränsat underskottsavdrag för kommanditdelägare', () => {
    const r = n3b({ result: -1000000, nonDeductible: 0, taxFree: 0, partners: [P(1, 50), P(2, 50, true, 200000)] });
    expect(r[0]).toMatchObject({ deficit: 500000, limitedCapped: false });
    expect(r[1]).toMatchObject({ deficit: 200000, limitedCapped: true });
    expect(n3b({ result: 900000, nonDeductible: 100000, taxFree: 0, partners: [P(1, 50), P(2, 50)] })[0].surplus).toBe(500000);
  });
});

import { activeTax, evaluate, fundLines, interestAllocation, propose } from '@/lib/ef-tax';
describe('Skatteplanering enskild firma', () => {
  const base = { result: 120000000, nonDeductible: 0, capitalStart: 100000000, capitalEnd: 150000000, expansionExisting: 0, slrPct: 2, municipalPct: 32, brytpunkt: 64000000 };
  it('räntefördelning', () => {
    expect(interestAllocation(100000000, 2)).toMatchObject({ kind: 'positive', max: 8000000 });
    expect(interestAllocation(4000000, 2).kind).toBe('none');
    expect(interestAllocation(-100000000, 2)).toMatchObject({ kind: 'negative', max: 3000000, mandatory: true });
  });
  it('egenavgifter och skatt', () => {
    const t = activeTax(100000000, base);
    expect(t.deduction).toBe(25000000);
    expect(t.taxable).toBe(75000000);
    expect(t.fees).toBe(Math.round(75000000 * 0.2897));
    expect(t.tax).toBe(24000000 + 2200000);
  });
  it('förslaget sänker skatten och håller sig inom gränserna', () => {
    const p = propose(base);
    expect(p.plan.interest).toBe(8000000);
    expect(p.plan.pfond).toBeLessThanOrEqual(p.pfondMax);
    expect(p.pfondMax).toBe(Math.floor(((120000000 - 8000000) * 0.3) / 10000) * 10000);
    expect(p.saving).toBeGreaterThan(0);
    expect(p.plan.total).toBeLessThan(p.base.total);
    expect(p.plan.active - Math.round(p.plan.active * 0.25)).toBeLessThanOrEqual(64000000 + 10000);
    expect(evaluate(base, { interest: 999999999, pfond: 0, expansion: 0 }).interest).toBe(8000000);
    expect(fundLines({ year: 2026, pfond: 100, expansion: 50 })).toEqual([{ account: 8811, amount: 100 }, { account: 2126, amount: -100 }, { account: 2010, amount: 50 }, { account: 2050, amount: -50 }]);
  });
});

import { adjustmentLines, completion, position } from '@/lib/poc';
describe('Successiv vinstavräkning', () => {
  it('färdigställandegrad och position', () => {
    const c = { value: 100000000, estimatedCost: 80000000 };
    expect(completion(c, { cost: 40000000, invoiced: 0 })).toBe(0.5);
    expect(position(c, { cost: 40000000, invoiced: 30000000 })).toMatchObject({ earned: 50000000, wip: 20000000, lossProvision: 0, margin: 10000000 });
    expect(position(c, { cost: 40000000, invoiced: 70000000 }).wip).toBe(-20000000);
    const loss = position({ value: 100000000, estimatedCost: 120000000 }, { cost: 60000000, invoiced: 0 });
    expect(loss).toMatchObject({ expectedLoss: 20000000, lossProvision: 10000000 });
  });
  it('bokar bara förändringen, även byte av sida', () => {
    const a = adjustmentLines({ wip: 20000000, lossProvision: 0 }, { wip: 0, lossProvision: 0 });
    expect(a).toEqual([{ account: 1620, amount: 20000000 }, { account: 3795, amount: -20000000 }]);
    const b = adjustmentLines({ wip: -5000000, lossProvision: 0 }, { wip: 20000000, lossProvision: 0 });
    expect(b.reduce((s, l) => s + l.amount, 0)).toBe(0);
    expect(b).toContainEqual({ account: 1620, amount: -20000000 });
    expect(b).toContainEqual({ account: 2450, amount: -5000000 });
    expect(adjustmentLines({ wip: 1, lossProvision: 0 }, { wip: 1, lossProvision: 0 })).toEqual([]);
  });
});
