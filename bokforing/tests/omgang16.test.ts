import { describe, expect, it } from 'vitest';
import { exitDates, fulfilment, grantLines, insatsLines, proportional, refundLines, yieldOf } from '@/lib/coop';

describe('Ekonomisk förening och stiftelse', () => {
  it('utträde: avgång vid räkenskapsårets slut minst en månad efter uppsägningen, utbetalning sex månader senare', () => {
    expect(exitDates('2025-03-10', ['2024-12-31', '2025-12-31'])).toEqual({ leavesOn: '2025-12-31', payableFrom: '2026-06-30' });
    expect(exitDates('2025-12-15', ['2025-12-31', '2026-12-31'])).toEqual({ leavesOn: '2026-12-31', payableFrom: '2027-06-30' });
    expect(exitDates('2025-05-20', ['2025-08-31', '2026-08-31'])).toEqual({ leavesOn: '2025-08-31', payableFrom: '2026-02-28' });
    expect(exitDates('2030-02-01', [])).toEqual({ leavesOn: '2030-12-31', payableFrom: '2031-06-30' });
  });
  it('återbäring fördelas efter köp och summerar på öret', () => {
    const r = proportional(100000, [{ id: 1, base: 1 }, { id: 2, base: 1 }, { id: 3, base: 1 }]);
    expect(r.map((x) => x.amount).reduce((a, b) => a + b)).toBe(100000);
    expect(r.map((x) => x.amount)).toEqual([33334, 33333, 33333]);
    expect(proportional(1000, [{ base: 300 }, { base: 100 }, { base: -50 }]).map((x) => x.amount)).toEqual([750, 250, 0]);
    expect(proportional(1000, [{ base: 0 }]).map((x) => x.amount)).toEqual([0]);
    expect(refundLines(500)).toEqual([{ account: 3739, amount: 500 }, { account: 2891, amount: -500 }]);
    expect(insatsLines('repaid', 200)).toEqual([{ account: 2083, amount: 200 }, { account: 1930, amount: -200 }]);
  });
  it('stiftelsens avkastning och fullföljdskravet över fem år', () => {
    const y = yieldOf(new Map([[8310, -100000], [3010, -20000], [6570, 10000], [6993, 60000], [1930, 5]]));
    expect(y).toEqual({ income: 120000, admin: 10000, yield: 110000, purpose: 60000 });
    const f = fulfilment([{ year: 2021, yield: 100, purpose: 0 }, { year: 2022, yield: 100, purpose: 0 }, { year: 2023, yield: 100, purpose: 0 }, { year: 2024, yield: 100, purpose: 0 }, { year: 2025, yield: 100, purpose: 400 }, { year: 2026, yield: 100, purpose: 0 }]);
    expect(f[4]).toMatchObject({ windowYield: 500, required: 400, shortfall: 0, pct: 80 });
    expect(f[5]).toMatchObject({ windowYears: 5, windowYield: 500, windowPurpose: 400, shortfall: 0 });
    expect(f[0]).toMatchObject({ required: 80, shortfall: 80 });
    expect(grantLines('pay', 10, 1940)).toEqual([{ account: 2895, amount: 10 }, { account: 1940, amount: -10 }]);
  });
});

import { ataEffect, rcCheck, retentionAmount, retentionLines, signed } from '@/lib/construction';
describe('Bygg och entreprenad', () => {
  it('ÄTA: godkända per datum ändrar kontraktssumman, avgående räknas negativt', () => {
    const os = [
      { kind: 'tillagg' as const, amount: 20000, cost: 12000, status: 'approved' as const, decided_on: '2026-03-01' },
      { kind: 'avgaende' as const, amount: 5000, cost: 3000, status: 'approved' as const, decided_on: '2026-03-02' },
      { kind: 'andring' as const, amount: 8000, cost: 0, status: 'proposed' as const, decided_on: null },
      { kind: 'tillagg' as const, amount: 9999, cost: 0, status: 'rejected' as const, decided_on: '2026-03-01' },
    ];
    expect(ataEffect(os, '2026-12-31')).toEqual({ value: 15000, cost: 9000, pending: 8000, pendingCount: 1 });
    expect(ataEffect(os, '2026-03-01').value).toBe(20000);
    expect(signed('avgaende', 100)).toBe(-100);
  });
  it('innehållna belopp', () => {
    expect(retentionAmount(10500000, 10, 10500000)).toBe(1050000);
    expect(retentionAmount(1000050, 10, 50000)).toBe(50000);
    expect(() => retentionAmount(100, 60, 100)).toThrow();
    expect(retentionLines('customer', 'retain', 5)).toEqual([{ account: 1682, amount: 5 }, { account: 1510, amount: -5 }]);
    expect(retentionLines('supplier', 'release', 5, 1940)).toEqual([{ account: 2446, amount: 5 }, { account: 1940, amount: -5 }]);
  });
  it('omvänd byggmoms kontrolleras per rad', () => {
    const v = rcCheck({ rcKind: 'construction', customerIsCompany: true, lines: [{ description: 'Takbyte etapp 1' }, { description: 'Konsultation och projektering' }, { description: 'Material' }] });
    expect(v.map((x) => x.status)).toEqual(['ok', 'warn', 'warn']);
    expect(rcCheck({ rcKind: 'construction', customerIsCompany: true, lines: [{ description: 'Material' }, { description: 'Frakt' }] })[0].note).toContain('vanlig moms');
    expect(rcCheck({ rcKind: '', customerIsCompany: true, lines: [{ description: 'Elinstallation kök' }] })[0].status).toBe('warn');
    expect(rcCheck({ rcKind: '', customerIsCompany: false, lines: [{ description: 'Elinstallation kök' }] })[0].status).toBe('ok');
    expect(rcCheck({ rcKind: 'construction', customerIsCompany: true, lines: [{ description: 'Byggstädning' }] })[0].status).toBe('ok');
  });
});

import { bookValue, countLines, fifoValue, lowestValue } from '@/modules/lager/calc';
describe('Lagervärdering', () => {
  const ms = [
    { date: '2026-01-01', qty: 10, unit_cost: 100, type: 'receipt' },
    { date: '2026-02-01', qty: 10, unit_cost: 120, type: 'receipt' },
    { date: '2026-02-05', qty: -4, unit_cost: 110, type: 'transfer' },
    { date: '2026-02-05', qty: 4, unit_cost: 110, type: 'transfer' },
    { date: '2026-03-01', qty: -15, unit_cost: 110, type: 'delivery' },
  ];
  it('FIFO värderar kvarvarande till de senaste inleveranserna', () => {
    expect(fifoValue(ms)).toMatchObject({ qty: 5, value: 600 });
    expect(fifoValue([...ms, { date: '2026-03-02', qty: -5, unit_cost: 0, type: 'adjustment' }])).toMatchObject({ qty: 0, value: 0 });
  });
  it('lägsta värdets princip med nettoförsäljningsvärde och inkurans, och 97 %-regeln', () => {
    const v = lowestValue([
      { sku: 'A', name: 'A', qty: 5, cost: 600, salesPrice: 100, obsoletePct: 0 },
      { sku: 'B', name: 'B', qty: 10, cost: 1000, salesPrice: 500, obsoletePct: 50 },
      { sku: 'C', name: 'C', qty: 2, cost: 200, salesPrice: 0, obsoletePct: 0 },
    ], 10);
    expect(v.rows.map((r) => r.lvp)).toEqual([450, 500, 200]);
    expect(v).toMatchObject({ cost: 1800, lvp: 1150, r97: 1746 });
    expect(bookValue(v, '97')).toEqual({ book: 1746, lowest: 'lvp', lowestValue: 1150 });
    expect(bookValue({ cost: 1000, lvp: 990, r97: 970 }, 'lvp')).toEqual({ book: 990, lowest: '97', lowestValue: 970 });
    expect(countLines(-500)).toEqual([{ account: 1460, amount: -500 }, { account: 4960, amount: 500 }]);
  });
});

import { balanceLines, balances, earned, grantReport, repaymentProvision } from '@/lib/grants';
describe('Bidrag', () => {
  const sum = (l: { amount: number }[]) => l.reduce((s, x) => s + x.amount, 0);
  it('intjänat i takt med kostnaderna, högst beviljat', () => {
    expect(earned(100000, 50, 1000000)).toBe(50000);
    expect(earned(5000000, 50, 1000000)).toBe(1000000);
    expect(earned(-10, 50, 100)).toBe(0);
  });
  it('förutbetalt används först, upplupet regleras först', () => {
    // 30 000 utbetalt i förskott, sedan intäktsförs 50 000
    const pay = balanceLines({ received: 0, recognized: 0 }, { received: 3000000, recognized: 0 });
    expect(pay).toEqual([{ account: 1930, amount: 3000000 }, { account: 2975, amount: -3000000 }]);
    const rec = balanceLines({ received: 3000000, recognized: 0 }, { received: 3000000, recognized: 5000000 });
    expect(rec).toEqual([{ account: 2975, amount: 3000000 }, { account: 1791, amount: 2000000 }, { account: 3980, amount: -5000000 }]);
    const pay2 = balanceLines({ received: 3000000, recognized: 5000000 }, { received: 6000000, recognized: 5000000 });
    expect(pay2).toEqual([{ account: 1930, amount: 3000000 }, { account: 2975, amount: -1000000 }, { account: 1791, amount: -2000000 }]);
    for (const l of [pay, rec, pay2]) expect(sum(l)).toBe(0);
    expect(balances(6000000, 5000000)).toEqual({ prepaid: 1000000, accrued: 0 });
  });
  it('sannolik återbetalning: intäkten förs tillbaka och utbetalt blir skuld', () => {
    const l = repaymentProvision(6000000, 5000000);
    expect(l).toEqual([{ account: 3980, amount: 5000000 }, { account: 2975, amount: 1000000 }, { account: 2976, amount: -6000000 }]);
    expect(sum(repaymentProvision(1000, 3000))).toBe(0);
  });
  it('rapport till bidragsgivaren', () => {
    expect(grantReport({ costsByAccount: [{ account: 5010, name: '', amount: 8000000 }, { account: 7010, name: '', amount: 2000000 }], coveragePct: 50, cap: 4000000, received: 3000000, budget: 20000000 }))
      .toEqual({ costs: 10000000, earned: 4000000, toRequest: 1000000, budgetUsedPct: 50, remainingGrant: 0 });
  });
});
