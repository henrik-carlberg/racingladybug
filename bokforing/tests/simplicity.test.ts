import { describe, it, expect } from 'vitest';
import { RECEIPT_CATEGORIES, receiptLines, paymentAccount } from '@/lib/receipts';
import { totals } from '@/lib/ledger-lines';

const cat = (k: string) => RECEIPT_CATEGORIES.find((c) => c.key === k)!;

describe('kvitton', () => {
  it('kontorsmaterial 25 % betalt med företagskort', () => {
    const r = receiptLines({ category: cat('kontor'), total: 50000, vatRate: 25, paidWith: 'company', companyType: 'AB' });
    expect(r.lines).toEqual([
      { account: 6110, debit: 40000, credit: 0, description: undefined },
      { account: 2641, debit: 10000, credit: 0, description: undefined },
      { account: 1930, debit: 0, credit: 50000, description: undefined },
    ]);
  });
  it('privat utlägg: skuld till ägaren i AB, egen insättning i EF', () => {
    expect(paymentAccount('private', 'AB')).toBe(2893);
    expect(paymentAccount('private', 'EF')).toBe(2018);
    const r = receiptLines({ category: cat('tag_flyg'), total: 10600, vatRate: 6, paidWith: 'private', companyType: 'EF' });
    expect(r.lines.find((l) => l.account === 2018)?.credit).toBe(10600);
    expect(r.vat).toBe(600);
    expect(totals(r.lines).balanced).toBe(true);
  });
  it('representation: momsavdrag högst 300 kr exkl. moms per person, resten kostnad', () => {
    // 2 personer, 1 120 kr inkl. 12 % moms → moms 120 kr, max avdrag 2 × 36 = 72 kr
    const r = receiptLines({ category: cat('representation'), total: 112000, vatRate: 12, persons: 2, paidWith: 'company', companyType: 'AB' });
    expect(r.vat).toBe(12000);
    expect(r.deductibleVat).toBe(7200);
    expect(r.lines.find((l) => l.account === 6072)?.debit).toBe(112000 - 7200);
    expect(r.lines.find((l) => l.account === 2641)?.debit).toBe(7200);
    expect(totals(r.lines).balanced).toBe(true);
    // under gränsen: hela momsen avdragsgill
    const small = receiptLines({ category: cat('representation'), total: 22400, vatRate: 12, persons: 1, paidWith: 'company', companyType: 'AB' });
    expect(small.deductibleVat).toBe(small.vat);
  });
  it('alla kategorier har giltiga konton och momssatser', () => {
    for (const c of RECEIPT_CATEGORIES) {
      expect(c.account).toBeGreaterThanOrEqual(4000);
      expect(c.account).toBeLessThan(8000);
      expect([0, 6, 12, 25]).toContain(c.vat);
    }
    expect(new Set(RECEIPT_CATEGORIES.map((c) => c.key)).size).toBe(RECEIPT_CATEGORIES.length);
  });
});
