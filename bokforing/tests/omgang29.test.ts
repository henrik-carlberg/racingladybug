import { describe, expect, it } from 'vitest';
import { applicable, creditLines, refundLines } from '@/lib/supplier-credit';

describe('Leverantörskrediter', () => {
  it('kontering och kvittning', () => {
    expect(creditLines([{ account: 4010, amount: 200000 }], 50000)).toEqual([{ account: 2440, amount: 250000 }, { account: 4010, amount: -200000 }, { account: 2641, amount: -50000 }]);
    expect(refundLines(125000)).toEqual([{ account: 1930, amount: 125000 }, { account: 2440, amount: -125000 }]);
    expect(applicable(250000, 1000000)).toBe(250000);
    expect(applicable(250000, 100000)).toBe(100000);
  });
});

import { reserveProposal } from '@/lib/bad-debts';
describe('Befarade kundförluster', () => {
  it('individuell bedömning före schablonen', () => {
    const base = { number: 1, customer: 'K', remaining: 0, collection: false };
    const r = reserveProposal([{ ...base, id: 1, due: '2026-05-01', net: 1000000, assessed: { pct: 40, note: 'x' } }, { ...base, id: 2, due: '2026-11-01', net: 800000, assessed: { pct: 50, note: 'y' } },
      { ...base, id: 3, due: '2026-05-01', net: 500000 }, { ...base, id: 4, due: '2026-12-15', net: 900000 }], '2026-12-31', 0);
    expect(r.target).toBe(400000 + 400000 + 500000);
    expect(r.others.map((o) => o.id)).toEqual([4]);
  });
});

import { allocate, interest } from '@/lib/payment-order';
describe('Betalningsföreläggande', () => {
  it('ränta och avräkningsordning', () => {
    expect(interest(1250000, 10, '2026-09-23', '2026-11-22')).toBe(20548);
    expect(allocate(40000, { fee: 30000, reminder: 6000, interest: 20548, capital: 1250000 })).toEqual({ fee: 30000, reminder: 6000, interest: 4000, capital: 0, excess: 0 });
    expect(allocate(2000000, { fee: 0, reminder: 0, interest: 16548, capital: 1250000 }).excess).toBe(733452);
  });
});

import { onHand, shipLines, soldLines } from '@/lib/consignment';
describe('Konsignation', () => {
  it('saldo och kontering', () => {
    expect(onHand([{ kind: 'ship', qty: 10 }, { kind: 'sold', qty: 4 }, { kind: 'return', qty: 2 }])).toBe(4);
    expect(shipLines(200000)).toEqual([{ account: 1465, amount: 200000 }, { account: 1460, amount: -200000 }]);
    expect(soldLines(80000)).toEqual([{ account: 4990, amount: 80000 }, { account: 1465, amount: -80000 }]);
  });
});

import { interest as taxInterest, interestLines, rates } from '@/lib/tax-interest';
describe('Ränta på skattekontot', () => {
  it('räntesatser och ränta per dag', () => {
    expect(rates(275)).toEqual({ cost: 1775, low: 375, income: 150 });
    const debt = Array.from({ length: 30 }, (_, i) => ({ date: `2026-04-${i + 1}`, balance: -3650000, deferred: 0 }));
    expect(taxInterest(debt, 275).cost).toBe(Math.round(36500 * 0.1775 * 30 / 365) * 100);
    const plus = debt.map((d) => ({ ...d, balance: 3650000 }));
    expect(taxInterest(plus, 275)).toMatchObject({ cost: 0, income: Math.round(36500 * 0.015 * 30 / 365) * 100 });
    const def = debt.map((d) => ({ ...d, deferred: 1000000 }));
    expect(taxInterest(def, 275).cost).toBe(Math.round((26500 * 0.1775 + 10000 * 0.0375) * 30 / 365) * 100);
    expect(interestLines(500, 0)).toEqual([{ account: 8423, amount: 500 }, { account: 1630, amount: -500 }]);
  });
});
