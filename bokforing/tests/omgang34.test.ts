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
