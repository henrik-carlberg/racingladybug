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
