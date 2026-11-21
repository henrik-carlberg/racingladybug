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
