import { describe, expect, it } from 'vitest';
import { duties, missingReports, reviewProgress, riskLevel } from '@/lib/work-environment';

describe('Arbetsmiljö', () => {
  it('riskvärde, anmälningsplikt och uppföljning', () => {
    expect(riskLevel(4, 4)).toEqual({ score: 16, level: 'high' });
    expect(riskLevel(2, 4).level).toBe('medium');
    expect(riskLevel(2, 2).level).toBe('low');
    expect(duties('near_miss')).toEqual({ av: false, fk: false });
    expect(duties('serious')).toEqual({ av: true, fk: true });
    expect(duties('injury')).toEqual({ av: false, fk: true });
    expect(missingReports({ kind: 'serious', date: '2026-11-22', reported_av_on: null, reported_fk_on: null }, '2026-11-24')).toEqual({ av: true, avLate: true, fk: true, fkLate: false });
    expect(missingReports({ kind: 'injury', date: '2026-11-10', reported_av_on: null, reported_fk_on: null }, '2026-11-24').fkLate).toBe(true);
    expect(reviewProgress(['policy', 'risks', 'x'])).toEqual({ done: 2, total: 9 });
  });
});

import { closeBlockers, deadline, incidentDuties } from '@/lib/data-protection';
describe('Dataskydd', () => {
  it('72-timmarsfristen och avslut', () => {
    expect(incidentDuties('none')).toEqual({ imy: false, subjects: false });
    expect(incidentDuties('high')).toEqual({ imy: true, subjects: true });
    const disc = new Date('2026-11-20T10:00:00Z');
    expect(deadline(disc, new Date('2026-11-22T10:00:00Z'))).toMatchObject({ hoursLeft: 24, late: false });
    expect(deadline(disc, new Date('2026-11-23T11:00:00Z')).late).toBe(true);
    const base = { risk: 'high' as const, reported_imy_at: null, subjects_informed_at: null, measures: '', late_reason: '', discovered_at: disc };
    expect(closeBlockers(base)).toEqual(['åtgärder', 'anmälan till IMY', 'information till de registrerade']);
    expect(closeBlockers({ ...base, measures: 'X', reported_imy_at: new Date('2026-11-24T10:00:00Z'), subjects_informed_at: new Date() })).toEqual(['skäl till försenad anmälan']);
    expect(closeBlockers({ ...base, risk: 'none', measures: 'X' })).toEqual([]);
  });
});

import { flagged, legalSex, levelGroups, payGroups } from '@/modules/lonerevision/calc';
describe('Lönekartläggning', () => {
  it('lika och likvärdigt arbete med flaggning', () => {
    expect(legalSex('19900101-1240')).toBe('K');
    const rows = [{ group: 'Utvecklare', sex: 'K' as const, salary: 4000000 }, { group: 'Utvecklare', sex: 'M' as const, salary: 4400000 }, { group: 'Ekonom', sex: 'K' as const, salary: 3000000 }];
    const g = payGroups(rows);
    expect(g.find((x) => x.group === 'Utvecklare')).toMatchObject({ ratio: 90.9 });
    expect(flagged(g.find((x) => x.group === 'Utvecklare')!)).toBe(true);
    expect(flagged(g.find((x) => x.group === 'Ekonom')!)).toBe(false);
    const l = levelGroups([{ level: 4, sex: 'K', salary: 4000000 }, { level: 4, sex: 'K', salary: 3000000 }, { level: 4, sex: 'M', salary: 4400000 }, { level: null, sex: 'M', salary: 1 }]);
    expect(l).toHaveLength(1); expect(l[0]).toMatchObject({ group: 'Kravnivå 4', ratio: 79.5 });
  });
});

import { matrix, periodOf, previous, riskScore, status } from '@/lib/internal-control';
describe('Internkontroll', () => {
  it('perioder, status och riskmatris', () => {
    expect(periodOf('monthly', '2026-11-24')).toBe('2026-11');
    expect(periodOf('quarterly', '2026-11-24')).toBe('2026-K4');
    expect(periodOf('yearly', '2026-11-24')).toBe('2026');
    expect(previous('monthly', '2026-01')).toBe('2025-12');
    expect(previous('quarterly', '2026-K1')).toBe('2025-K4');
    expect(status('monthly', '2026-09', ['2026-09'], '2026-11-24')).toMatchObject({ last: '2026-10', missing: true });
    expect(status('monthly', '2026-11', [], '2026-11-24').missing).toBe(false);
    expect(riskScore(3, 5)).toEqual({ score: 15, level: 'high' });
    expect(matrix([{ likelihood: 3, impact: 5 }, { likelihood: 2, impact: 2 }])[2][4]).toBe(1);
  });
});

import { effectiveRate, schedule, settlement, settlementLines } from '@/lib/interest-swaps';
describe('Räntesäkring', () => {
  it('perioder, avräkning och effektiv ränta', () => {
    expect(schedule('2026-01-31', '2026-08-15', 3)).toEqual([{ start: '2026-01-31', end: '2026-04-30' }, { start: '2026-04-30', end: '2026-07-31' }, { start: '2026-07-31', end: '2026-08-15' }]);
    expect(settlement(100000000, 3, 4, 90)).toBe(250000);
    expect(settlement(100000000, 3, 2.5, 90)).toBe(-125000);
    expect(settlementLines(250000)).toEqual([{ account: 1930, amount: 250000 }, { account: 8410, amount: -250000 }]);
    expect(settlementLines(-125000)).toEqual([{ account: 8410, amount: 125000 }, { account: 1930, amount: -125000 }]);
    expect(effectiveRate(5.2, 4, 3, 100000000, 100000000)).toBe(4.2);
    expect(effectiveRate(5.2, 4, 3, 50000000, 100000000)).toBe(4.7);
  });
});

