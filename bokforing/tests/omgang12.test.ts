import { describe, expect, it } from 'vitest';
import { count, fmtRanges, issueEntries, normalize, ownership, take } from '@/lib/shares';

describe('Aktiebok', () => {
  it('nummerserier och överlåtelse', () => {
    expect(normalize([{ from: 501, to: 1000 }, { from: 1, to: 500 }])).toEqual([{ from: 1, to: 1000 }]);
    const t = take([{ from: 1, to: 300 }, { from: 501, to: 600 }], 350);
    expect(t.taken).toEqual([{ from: 1, to: 300 }, { from: 501, to: 550 }]);
    expect(t.left).toEqual([{ from: 551, to: 600 }]);
    expect(count(t.left)).toBe(50);
    expect(fmtRanges(t.taken)).toBe('1–300, 501–550');
    expect(() => take([{ from: 1, to: 10 }], 11)).toThrow();
  });
  it('nyemission bokas på ej registrerat aktiekapital och överkurs', () => {
    const e = issueEntries({ newShares: 100, pricePerShare: 50000, quota: 10000 });
    expect(e).toMatchObject({ total: 5000000, capital: 1000000, premium: 4000000 });
    expect(e.payment).toEqual([{ account: 1930, amount: 5000000 }, { account: 2082, amount: -1000000 }, { account: 2097, amount: -4000000 }]);
    expect(() => issueEntries({ newShares: 1, pricePerShare: 1, quota: 10000 })).toThrow();
  });
  it('kapital- och röstandel', () => {
    const o = ownership([{ key: 'x', a: 100, b: 0 }, { key: 'y', a: 0, b: 900 }]);
    expect(o[0].pct).toBe(10); expect(Math.round(o[0].votePct * 10) / 10).toBe(52.6);
  });
});

import { DEFAULT_CATEGORIES, emissions } from '@/lib/climate';
describe('Klimatbokföring', () => {
  it('schabloner per konto och scope', () => {
    const e = emissions({ costs: new Map([[5611, 1000000], [5020, 500000], [4010, 2000000], [1930, 999999]]), categories: DEFAULT_CATEGORIES, activities: [], privateKm: 0 });
    expect(e.byScope).toEqual({ 1: 2500, 2: 150, 3: 6000 });
    expect(e.rows[0].label).toBe('Inköp av varor och material');
  });
  it('exakta värden ersätter schablonen för samma kategori', () => {
    const e = emissions({ costs: new Map([[5611, 1000000], [5020, 500000]]), categories: DEFAULT_CATEGORIES, activities: [{ kind: 'diesel_l', quantity: 500 }], privateKm: 1000 });
    expect(e.byScope[1]).toBe(1300);
    expect(e.rows.find((r) => r.key === 'car')!.kg).toBe(120);
    expect(e.total).toBe(1300 + 150 + 120);
  });
});
