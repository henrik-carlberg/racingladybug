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
