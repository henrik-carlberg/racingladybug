import { describe, expect, it } from 'vitest';
import { bookingPrice, daysSpanned, hoursBetween, overlaps, utilization, weekly, withinOpenHours, workdaysInMonth } from '@/modules/resurser/calc';

describe('resursbokning', () => {
  it('krockar', () => {
    expect(overlaps('2026-11-23 09:00', '2026-11-23 11:00', '2026-11-23 10:00', '2026-11-23 12:00')).toBe(true);
    expect(overlaps('2026-11-23 09:00', '2026-11-23 11:00', '2026-11-23 11:00', '2026-11-23 12:00')).toBe(false);
  });
  it('timmar, dagar och pris', () => {
    expect(hoursBetween('2026-11-23 09:00', '2026-11-23 11:30')).toBe(2.5);
    expect(daysSpanned('2026-11-23 09:00', '2026-11-25 12:00')).toBe(3);
    expect(daysSpanned('2026-11-23 09:00', '2026-11-24 00:00')).toBe(1);
    expect(bookingPrice('2026-11-23 09:00', '2026-11-23 11:00', 50000, 300000)).toEqual({ amount: 100000, unit: 'h', qty: 2, unitPrice: 50000 });
    expect(bookingPrice('2026-11-23 08:00', '2026-11-23 17:00', 50000, 300000)).toEqual({ amount: 300000, unit: 'dag', qty: 1, unitPrice: 300000 });
    expect(bookingPrice('2026-11-23 08:00', '2026-11-23 17:00', 0, 0).amount).toBe(0);
  });
  it('öppettider och återkommande', () => {
    expect(withinOpenHours('2026-11-23 07:00', '2026-11-23 08:00', '08:00', '17:00')).toBe(false);
    expect(withinOpenHours('2026-11-23 08:00', '2026-11-23 17:00', '08:00', '17:00')).toBe(true);
    expect(weekly('2026-11-30', 3)).toEqual(['2026-11-30', '2026-12-07', '2026-12-14']);
  });
  it('beläggning', () => {
    expect(workdaysInMonth('2026-11')).toBe(21);
    expect(utilization(45, '08:00', '17:00', 21)).toBe(23.8);
  });
});
