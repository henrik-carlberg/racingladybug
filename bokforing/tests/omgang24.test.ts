import { describe, expect, it } from 'vitest';
import { distributionLines, gains } from '@/lib/liquidation';

describe('Skifte vid likvidation', () => {
  it('eget kapital och resultat mot kassan', () => {
    const r = distributionLines(new Map([[1930, 3500000], [2081, -2500000], [3010, -1000000]]));
    expect(r.net).toBe(3500000);
    expect(r.lines).toEqual([{ account: 1930, amount: -3500000 }, { account: 2081, amount: 2500000 }, { account: 2099, amount: 1000000 }]);
    expect(() => distributionLines(new Map([[1930, 100], [1220, 100], [2081, -200]]))).toThrow(/konto 1220/);
    expect(gains([{ name: 'A', amount: 2100000, costBasis: 1500000 }])[0].gain).toBe(600000);
  });
});

import { benefitRate, loanItems } from '@/lib/employee-loans';
describe('Medarbetarlån', () => {
  it('förmånsränta och lönerader', () => {
    expect(benefitRate(2026)).toBeCloseTo(3.55);
    const r = loanItems({ balance: 12000000, agreedRate: 1, installment: 1000000 }, 2026);
    expect(r).toMatchObject({ amortization: 1000000, interest: 10000, benefit: 25500 });
    expect(r.items.map((i) => i.type)).toEqual(['net_deduction', 'benefit']);
    expect(loanItems({ balance: 50000, agreedRate: 5, installment: 1000000 }, 2026)).toMatchObject({ amortization: 50000, benefit: 0 });
  });
});

import { credit, paymentLines, reportLines, royalty } from '@/lib/royalty';
describe('Royalty', () => {
  it('minimiavgift, moms, källskatt', () => {
    expect(royalty(10000000, 5, 1000000)).toBe(1000000);
    expect(royalty(50000000, 8, 0)).toBe(4000000);
    expect(reportLines(1000000, true).lines).toEqual([{ account: 1680, amount: 1250000 }, { account: 3920, amount: -1000000 }, { account: 2611, amount: -250000 }]);
    expect(paymentLines(4000000, 400000)).toEqual([{ account: 1930, amount: 3600000 }, { account: 8910, amount: 400000 }, { account: 1680, amount: -4000000 }]);
    expect(credit(4000000, 400000, 0)).toEqual({ limit: 824000, creditable: 0, reclaim: 400000 });
    expect(credit(4000000, 400000, 10)).toEqual({ limit: 824000, creditable: 400000, reclaim: 0 });
  });
});
