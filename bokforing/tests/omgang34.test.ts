import { describe, expect, it } from 'vitest';
import { doneLines, freeSlots, keepAndRefundLines, keepOnCancel, prepayLines, toMin, weekday } from '@/lib/bookings';

describe('Tidsbokning', () => {
  it('tider, krockar och kontering', () => {
    expect(toMin('09:30')).toBe(570);
    expect(toMin('25:00')).toBeNull();
    expect(weekday('2026-11-23')).toBe(1);
    const slots = freeSlots({ from: 540, to: 700, minutes: 45, booked: [{ start: 600, end: 645 }] });
    expect(slots).toEqual([540, 555, 645]);
    expect(prepayLines(50000, 25)).toEqual([{ account: 1930, amount: 50000 }, { account: 2420, amount: -40000 }, { account: 2611, amount: -10000 }]);
    expect(doneLines(50000, 25, true)).toEqual([{ account: 2420, amount: 40000 }, { account: 3001, amount: -40000 }]);
    const k = keepAndRefundLines(50000, 25, 25000);
    expect(k.reduce((s, l) => s + l.amount, 0)).toBe(0);
    expect(k).toEqual([{ account: 2420, amount: 40000 }, { account: 3001, amount: -20000 }, { account: 2611, amount: 5000 }, { account: 1930, amount: -25000 }]);
    expect(keepOnCancel({ price: 50000, hoursBefore: 48, cancelHours: 24, noShowPct: 50 })).toBe(0);
    expect(keepOnCancel({ price: 50000, hoursBefore: 2, cancelHours: 24, noShowPct: 50 })).toBe(25000);
  });
});

import { fromProvision, inWarranty, provisionUseLines, warrantyRate, warrantyUntil } from '@/lib/service-cases';
describe('Service och garanti', () => {
  it('garantitid och avsättning', () => {
    expect(warrantyUntil('2026-01-31', 12)).toBe('2027-01-31');
    expect(inWarranty('2026-01-31', 12, '2026-11-23')).toBe(true);
    expect(inWarranty('2026-01-31', 0, '2026-11-23')).toBe(false);
    expect(inWarranty(null, 12, '2026-11-23')).toBe(false);
    expect(fromProvision(150000, 200000)).toBe(150000);
    expect(fromProvision(150000, 50000)).toBe(50000);
    expect(provisionUseLines(150000, 2220, 6990)).toEqual([{ account: 2220, amount: 150000 }, { account: 6990, amount: -150000 }]);
    expect(warrantyRate(150000, 10000000)).toBe(1.5);
  });
});

import { accruedInterest, conversionLines, dilution, exerciseLines, issueLines } from '@/lib/share-instruments';
describe('Konvertibler och optioner', () => {
  it('ränta, konvertering, teckning och utspädning', () => {
    expect(issueLines('warrant', 200000)).toEqual([{ account: 1930, amount: 200000 }, { account: 2097, amount: -200000 }]);
    expect(accruedInterest({ amount: 10000000, pct: 5, from: '2026-01-01', to: '2026-03-15', booked: 0 })).toBe(100000);
    expect(accruedInterest({ amount: 10000000, pct: 5, from: '2026-01-01', to: '2026-03-15', booked: 100000 })).toBe(0);
    expect(conversionLines(10000000, 2000, 2500).lines).toEqual([{ account: 2320, amount: 10000000 }, { account: 2081, amount: -5000000 }, { account: 2097, amount: -5000000 }]);
    expect(() => conversionLines(100, 2000, 2500)).toThrow();
    expect(exerciseLines(100, 4000, 2500)).toMatchObject({ total: 400000, capital: 250000 });
    const d = dilution([{ name: 'A', shares: 1000 }], [{ name: 'B', shares: 2000 }, { name: 'C', shares: 100 }]);
    expect(d.find((x) => x.name === 'A')).toMatchObject({ pct: 100, diluted: 32.3 });
  });
});

import { assignmentResult, invoicedHours, markupPct } from '@/lib/subcontractors';
describe('Underkonsulter', () => {
  it('påslag, timmar och marginal', () => {
    expect(markupPct(80000, 100000)).toBe(25);
    expect(invoicedHours(8400000, 80000)).toBe(105);
    const r = assignmentResult([{ hours: 100, billed: true, supplier_hours: 105 }, { hours: 80, billed: false, supplier_hours: null }], 80000, 100000);
    expect(r).toEqual({ hours: 180, billedHours: 100, supplierHours: 105, revenue: 10000000, cost: 8400000, margin: 1600000, warning: 5 });
  });
});

import { commitmentsFor, daysLeft, docsReady, feeLines } from '@/lib/trade-finance';
describe('Remburser och garantier', () => {
  it('åtaganden, dokument och avgifter', () => {
    expect(commitmentsFor('guarantee_given', 20000000, 0)).toEqual({ guarantee: 20000000, pledge: 0 });
    expect(commitmentsFor('lc_import', 57500000, 10000000)).toEqual({ guarantee: 0, pledge: 10000000 });
    expect(commitmentsFor('guarantee_received', 100, 0)).toEqual({ guarantee: 0, pledge: 0 });
    expect(docsReady([{ done: true }, { done: false }])).toBe(false);
    expect(daysLeft('2026-12-13', '2026-11-23')).toBe(20);
    expect(feeLines(150000)).toEqual([{ account: 6570, amount: 150000 }, { account: 1930, amount: -150000 }]);
  });
});
