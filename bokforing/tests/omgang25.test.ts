import { describe, expect, it } from 'vitest';
import { settle, settleLines } from '@/lib/vmb';
import { vatReport } from '@/lib/vat';

describe('Vinstmarginalbeskattning', () => {
  it('marginal, överföring och ruta 07', () => {
    expect(settle({ sales: 800000, purchases: 1000000, carriedIn: 0 })).toEqual({ margin: -200000, vat: 0, base: 0, carryOut: 200000 });
    expect(settle({ sales: 1950000, purchases: 500000, carriedIn: 200000 })).toEqual({ margin: 1250000, vat: 250000, base: 1000000, carryOut: 0 });
    const l = settleLines(250000, 1000000);
    const sums = new Map(l.map((x) => [x.account, x.amount]));
    const r = vatReport(sums);
    expect(r.boxes.find((b) => b.box === '07')?.amount).toBe(1000000);
    expect(r.boxes.find((b) => b.box === '10')?.amount).toBe(250000);
  });
});

import { deviation, file, obligation, validate } from '@/lib/intrastat';
describe('Intrastat', () => {
  it('tröskel, kontroll och fil', () => {
    expect(obligation('dispatch', 400000000)).toMatchObject({ required: false, warning: true });
    expect(obligation('dispatch', 500000000).required).toBe(true);
    const l = { flow: 'dispatch' as const, kn: '94036010', country: 'DE', origin: '', txn: '11', value: 400000000, mass: 1200, supp: null };
    expect(validate(l)).toBeNull();
    expect(validate({ ...l, country: 'SE' })).toMatch(/EU-land/);
    expect(validate({ ...l, flow: 'arrival' })).toMatch(/ursprungsland/);
    expect(deviation(105, 100)).toBe(5);
    expect(file('2026-10', [l])).toContain('2;202610;94036010;DE;;11;4000000;1200;');
  });
});

import { deductionRoom, depositRoom } from '@/lib/forest';
describe('Skogskonto', () => {
  it('utrymme och skogsavdrag', () => {
    const sales = [{ kind: 'rotpost' as const, amount: 10000000 }, { kind: 'leveransvirke' as const, amount: 5000000 }];
    expect(depositRoom(sales, 'skog', { skog: 0, skada: 0 })).toBe(8000000);
    expect(depositRoom(sales, 'skada', { skog: 4000000, skada: 0 })).toBe(5250000);
    expect(depositRoom(sales, 'skog', { skog: 0, skada: 10500000 })).toBe(0);
    expect(deductionRoom(sales, 12000000, 0)).toEqual({ ofIncome: 6500000, total: 6000000, max: 6000000 });
  });
});

import { classify, flag, halfPriceBase } from '@/lib/small-assets';
describe('Direktavdrag', () => {
  it('bedömning och flaggning', () => {
    expect(halfPriceBase(2026)).toBe(2960000);
    expect(classify({ price: 2000000, lifeYears: 5, related: 0, year: 2026 }).verdict).toBe('small_value');
    expect(classify({ price: 2000000, lifeYears: 5, related: 6000000, year: 2026 }).verdict).toBe('asset');
    expect(classify({ price: 9000000, lifeYears: 3, related: 0, year: 2026 }).verdict).toBe('short_life');
    const f = flag([{ voucherId: 1, date: '2026-05-10', text: 'Kontorsmöbler: skrivbord', amount: 1800000 }, { voucherId: 2, date: '2026-05-10', text: 'Kontorsmöbler: stolar', amount: 1500000 },
      { voucherId: 3, date: '2026-06-02', text: 'Pärmar', amount: 90000 }], 2026);
    expect(f.map((x) => [x.voucherId, x.flagged])).toEqual([[1, 'related'], [2, 'related']]);
  });
});

import { giftLines, sponsorLines } from '@/lib/sponsorship';
describe('Sponsring och gåvor', () => {
  it('avdragsrätt och moms', () => {
    expect(sponsorLines({ amount: 2000000, vat: 500000, counter: true }).lines).toContainEqual({ account: 2641, amount: 500000 });
    expect(sponsorLines({ amount: 500000, vat: 0, counter: false })).toMatchObject({ deductible: false, lines: [{ account: 6993, amount: 500000 }, { account: 1930, amount: -500000 }] });
    expect(giftLines({ amount: 250000, vat: 62500, recipients: 10 })).toMatchObject({ per: 25000, deductible: true });
    expect(giftLines({ amount: 200000, vat: 50000, recipients: 4 }).lines[0]).toEqual({ account: 6993, amount: 250000 });
  });
});
