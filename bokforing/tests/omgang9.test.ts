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

import { decide, fullPnr, parseRepresentation, soleTraderPnrs } from '@/lib/signatory';
describe('Firmateckning', () => {
  const r = parseRepresentation({ namn: 'Testbolaget AB', firmateckning: { antalIForening: 2, text: 'Två ledamöter i förening' }, foretradare: [
    { personnummer: '19800101-0019', namn: 'Ägare Testsson', roller: ['Styrelseledamot', 'Verkställande direktör'] },
    { personnummer: '7505050000', namn: 'Bo Delägare', roller: ['Styrelseledamot'] },
    { personnummer: '196001010000', namn: 'Revi Sor', roller: ['Revisor'] },
    { personnummer: 'fel', namn: 'Ingen' },
  ] });
  it('läser företrädare', () => {
    expect(r.reps.map((x) => x.pnr)).toEqual(['198001010019', '197505050000', '196001010000']);
    expect(r.jointly).toBe(2);
  });
  it('två ledamöter i förening krävs; revisorn räknas inte', () => {
    expect(decide(r, ['198001010019'])).toMatchObject({ verified: false, missing: 1 });
    expect(decide(r, ['198001010019', '196001010000'])).toMatchObject({ verified: false, missing: 1 });
    expect(decide(r, ['198001010019', '197505050000'])).toMatchObject({ verified: true, missing: 0 });
    expect(decide(r, ['199912310000']).verified).toBe(false);
  });
  it('ensam firmatecknare räcker', () => {
    const e = parseRepresentation({ foretradare: [{ personnummer: '198001010019', namn: 'A', roller: ['Styrelseledamot'], ensamFirmatecknare: true }] });
    expect(decide(e, ['198001010019']).verified).toBe(true);
  });
  it('personnummer och enskild firma', () => {
    expect(fullPnr('0501011234', new Date('2026-01-01'))).toBe('200501011234');
    expect(fullPnr('8112189876', new Date('2026-01-01'))).toBe('198112189876');
    expect(soleTraderPnrs('811218-9876')).toEqual(['19811218987' + '6', '20811218' + '9876']);
  });
});
