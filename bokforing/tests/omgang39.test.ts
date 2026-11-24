import { describe, expect, it } from 'vitest';
import { conversion, daysWithin, priority, seniority, type Period } from '@/lib/las';

describe('LAS', () => {
  it('övergång, företrädesrätt och turordning', () => {
    expect(daysWithin([{ form: 'sav', start: '2026-01-01', end: '2026-01-10' }], '2026-01-05', '2026-12-31')).toBe(6);
    const p: Period[] = [{ form: 'sav', start: '2025-01-01', end: '2025-06-30' }, { form: 'sav', start: '2026-01-01', end: null }];
    const c = conversion(p, '2026-06-01')!;
    expect(c.used).toBe(181 + 152); expect(c.left).toBe(365 - 333); expect(c.warn).toBe(true); expect(c.converted).toBe(false);
    expect(conversion([{ form: 'tillsvidare', start: '2020-01-01', end: null }], '2026-06-01')).toBeNull();
    expect(conversion([{ form: 'vikariat', start: '2025-01-01', end: null }], '2026-06-01')!.left).toBe(730 - 517);
    expect(priority([{ form: 'sav', start: '2025-01-01', end: '2026-03-31', shortage: true }], '2026-06-01')).toEqual({ qualifying: true, endedOn: '2026-03-31', until: '2026-12-31', active: true });
    expect(priority([{ form: 'sav', start: '2026-01-01', end: '2026-03-31', shortage: true }], '2026-06-01')!.active).toBe(false);
    expect(seniority([{ name: 'A', days: 100, birth: '19900101', exempt: false }, { name: 'B', days: 100, birth: '19800101', exempt: false }, { name: 'C', days: 900, birth: '20000101', exempt: false }]).map((x) => x.name)).toEqual(['C', 'B', 'A']);
  });
});

import { expiry } from '@/lib/authorizations';
describe('Fullmakter och tillstånd', () => {
  it('giltighet', () => {
    expect(expiry(null, '2026-11-24')).toEqual({ status: 'open', days: null });
    expect(expiry('2027-01-23', '2026-11-24')).toEqual({ status: 'expiring', days: 60 });
    expect(expiry('2026-11-01', '2026-11-24').status).toBe('expired');
    expect(expiry('2027-06-01', '2026-11-24').status).toBe('valid');
  });
});

import { match, namesFromCsv, normalize, similarity } from '@/lib/sanctions';
describe('Sanktionslistor', () => {
  it('normalisering, matchning och CSV', () => {
    expect(normalize('Global Shadow Trading, LLC')).toBe('global shadow trading');
    expect(normalize('Sidorov Ivan Petrovich')).toBe(normalize('Ivan Petrovich SIDOROV'));
    expect(normalize('Åsa Öberg AB')).toBe('asa oberg');
    expect(similarity('ahmad al rashid', 'ahmed al rashid')).toBeGreaterThan(0.9);
    expect(match(normalize('Ahmad Al Rashid'), normalize('Ahmed AL-RASHID'))).toBeGreaterThan(85);
    expect(match(normalize('Svensson Bygg AB'), normalize('Ivan Petrovich SIDOROV'))).toBe(0);
    expect(match('ivan sidorov', 'ivan petrovich sidorov')).toBe(90);
    expect(namesFromCsv('Entity;Naal_wholename\n1;"Doe, John"\n2;Jane Roe\n3;Jane Roe\n')).toEqual(['Doe, John', 'Jane Roe']);
    expect(namesFromCsv('Acme Ltd\nFoo Bar\n')).toEqual(['Acme Ltd', 'Foo Bar']);
  });
});

import { progress } from '@/lib/active-measures';
describe('Aktiva åtgärder', () => {
  it('framsteg för året', () => {
    const base = { measure: '', due_date: null, done_on: null, follow_up: '' };
    const all = (['conditions', 'pay', 'recruitment', 'training', 'parenthood'] as const).map((area) => ({ ...base, area }));
    expect(progress(all, true, '2026-11-24').complete).toBe(true);
    expect(progress(all, false, '2026-11-24').complete).toBe(false);
    const p = progress([{ ...base, area: 'pay', measure: 'Höj', due_date: '2026-11-01' }, { ...base, area: 'conditions', measure: 'X', due_date: '2026-12-01', done_on: '2026-11-20' }], true, '2026-11-24');
    expect(p).toMatchObject({ covered: 2, overdue: 1, notFollowed: 1, complete: false });
    expect(p.missing).toEqual(['recruitment', 'training', 'parenthood']);
  });
});

import { appealDeadline, decisionLines, requestStatus } from '@/lib/tax-audits';
describe('Skatterevision', () => {
  it('frist, kontering och status', () => {
    expect(appealDeadline(2025)).toBe('2031-12-31');
    expect(decisionLines('vat', 2000000, 400000, 80000)).toEqual([{ account: 6991, amount: 2000000 }, { account: 6992, amount: 400000 }, { account: 8423, amount: 80000 }, { account: 1630, amount: -2480000 }]);
    expect(decisionLines('income', 0, 0, 0)).toEqual([]);
    expect(requestStatus('2026-11-20', null, '2026-11-24')).toBe('late');
    expect(requestStatus('2026-11-28', null, '2026-11-24')).toBe('soon');
    expect(requestStatus('2026-11-20', '2026-11-19', '2026-11-24')).toBe('answered');
  });
});

