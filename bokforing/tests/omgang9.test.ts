import { describe, expect, it } from 'vitest';
import { angleOf, icsCalendar, itemStatus, occurrences, sector } from '@/lib/wheel';

describe('Årshjul: återkommande datum', () => {
  it('varje månad, dag 31 blir sista dagen', () => {
    expect(occurrences({ recurrence: 'monthly', startDate: '2026-01-01', day: 31 }, '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
  it('varje kvartal från andra månaden i kvartalet', () => {
    expect(occurrences({ recurrence: 'quarterly', startDate: '2026-01-01', day: 5, month: 2 }, '2026-01-01', '2026-12-31')).toEqual(['2026-02-05', '2026-05-05', '2026-08-05', '2026-11-05']);
  });
  it('varje år, start- och slutdatum respekteras', () => {
    expect(occurrences({ recurrence: 'yearly', startDate: '2026-06-01', day: 15, month: 3 }, '2026-01-01', '2028-12-31')).toEqual(['2027-03-15', '2028-03-15']);
    expect(occurrences({ recurrence: 'yearly', startDate: '2026-01-01', endDate: '2027-12-31', day: 15, month: 3 }, '2026-01-01', '2028-12-31')).toEqual(['2026-03-15', '2027-03-15']);
  });
  it('varje vecka på en veckodag och en gång', () => {
    expect(occurrences({ recurrence: 'weekly', startDate: '2026-11-01', day: 1 }, '2026-11-01', '2026-11-30')).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']);
    expect(occurrences({ recurrence: 'once', startDate: '2026-11-19' }, '2026-11-01', '2026-11-30')).toEqual(['2026-11-19']);
    expect(occurrences({ recurrence: 'once', startDate: '2026-12-19' }, '2026-11-01', '2026-11-30')).toEqual([]);
  });
});
describe('Årshjul: geometri, status och kalender', () => {
  it('vinklar', () => {
    expect(angleOf('2026-01-01', 'year')).toBeLessThan(0.02);
    expect(angleOf('2026-07-02', 'year')).toBeCloseTo(Math.PI, 1);
    expect(angleOf('2026-11-15', 'month')).toBeCloseTo((14.5 / 30) * 2 * Math.PI, 5);
    expect(sector(100, 100, 50, 80, 0, Math.PI / 2)).toMatch(/^M100\.00 20\.00A80 80 0 0 1 180\.00 100\.00L150\.00 100\.00A50 50 0 0 0 100\.00 50\.00Z$/);
  });
  it('status', () => {
    const i = { key: 'k', date: '2026-11-20', module: 'lon' as const, title: 'x', done: false, own: true };
    expect(itemStatus(i, '2026-11-19')).toBe('soon'); expect(itemStatus(i, '2026-11-21')).toBe('overdue'); expect(itemStatus({ ...i, done: true }, '2026-11-21')).toBe('done');
    expect(itemStatus(i, '2026-10-01')).toBe('upcoming');
  });
  it('iCal', () => {
    const c = icsCalendar('Årshjul; Test', [{ key: 'egen:1:2026-11-20', date: '2026-11-20', title: 'Lönesamtal, Anna', done: false }], new Date('2026-11-19T10:00:00Z'));
    expect(c).toContain('BEGIN:VCALENDAR\r\n'); expect(c).toContain('DTSTART;VALUE=DATE:20261120'); expect(c).toContain('DTEND;VALUE=DATE:20261121');
    expect(c).toContain('SUMMARY:Lönesamtal\\, Anna'); expect(c).toContain('X-WR-CALNAME:Årshjul\\; Test'); expect(c).toContain('UID:egen:1:2026-11-20@bokforing');
  });
});
