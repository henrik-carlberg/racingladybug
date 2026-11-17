import { describe, expect, it } from 'vitest';
import { bankStatement, fmtHours, hoursQty, isoWeek, monthName, monthRange, parseDuration, previousMonth, timeInvoiceLines, weekStart } from '@/lib/time';

describe('tidsinmatning', () => {
  it('tolkar olika format', () => {
    expect(parseDuration('1,5')).toBe(90);
    expect(parseDuration('1.25')).toBe(75);
    expect(parseDuration('1:30')).toBe(90);
    expect(parseDuration('0:45')).toBe(45);
    expect(parseDuration('90m')).toBe(90);
    expect(parseDuration('2h')).toBe(120);
    expect(parseDuration('2 h 15 min')).toBe(135);
    expect(parseDuration('8')).toBe(480);
    expect(parseDuration('abc')).toBeNull();
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('1:75')).toBeNull();
  });
  it('visar timmar', () => {
    expect(fmtHours(90)).toBe('1,5 h');
    expect(fmtHours(50)).toBe('0,83 h');
    expect(hoursQty(50)).toBe(0.833);
  });
});

describe('fakturaunderlag', () => {
  it('grupperar per aktivitet och timpris', () => {
    const lines = timeInvoiceLines([
      { minutes: 90, activity: 'Utveckling', rate: 100000 },
      { minutes: 30, activity: 'Utveckling', rate: 100000 },
      { minutes: 60, activity: 'Möte', rate: 80000 },
    ], { suffix: 'Webbshop', vatRate: 25 });
    expect(lines).toEqual([
      { description: 'Utveckling, Webbshop', quantity: 2, unit: 'h', unit_price: 100000, vat_rate: 25 },
      { description: 'Möte, Webbshop', quantity: 1, unit: 'h', unit_price: 80000, vat_rate: 25 },
    ]);
  });
});

describe('timbank', () => {
  it('drar timmar och visar kvar', () => {
    expect(bankStatement(40 * 60, 10 * 60, 12 * 60)).toEqual({ purchased: 2400, drawnBefore: 600, usedNow: 720, drawn: 720, overage: 0, remaining: 1080 });
  });
  it('fakturerar timmar utöver banken', () => {
    const s = bankStatement(10 * 60, 8 * 60, 5 * 60);
    expect(s.drawn).toBe(120);
    expect(s.overage).toBe(180);
    expect(s.remaining).toBe(0);
  });
  it('tom bank: allt är övertid', () => {
    expect(bankStatement(0, 0, 60).overage).toBe(60);
  });
});

describe('datum', () => {
  it('månader och veckor', () => {
    expect(monthName('2026-10')).toBe('oktober 2026');
    expect(monthRange('2027-02')).toEqual(['2027-02-01', '2027-02-28']);
    expect(previousMonth('2027-01-03')).toBe('2026-12');
    expect(weekStart('2026-11-19')).toBe('2026-11-16');
    expect(weekStart('2026-11-22')).toBe('2026-11-16');
    expect(isoWeek('2026-11-17')).toBe(47);
    expect(isoWeek('2027-01-01')).toBe(53);
  });
});
