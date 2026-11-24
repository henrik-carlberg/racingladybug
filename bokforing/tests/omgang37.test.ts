import { describe, expect, it } from 'vitest';
import { defaultAgenda, followUp, minutesHtml, missingAgmItems, quorum } from '@/lib/board-meetings';

describe('Styrelsemöten', () => {
  it('dagordning, beslutförhet, uppföljning och protokoll', () => {
    expect(defaultAgenda('agm')).toEqual(expect.arrayContaining(['annual_report', 'dividend', 'discharge']));
    expect(missingAgmItems(['open', 'annual_report'])).toEqual(['dividend', 'discharge']);
    expect(quorum(['Anna', 'Bertil', 'Cecilia'], ['anna '])).toEqual({ members: 3, here: 1, needed: 2, ok: false });
    expect(quorum(['Anna', 'Bertil', 'Cecilia', 'David'], ['Anna', 'Bertil', 'Cecilia']).ok).toBe(true);
    expect(quorum(['Anna', 'Bertil', 'Cecilia', 'David'], ['Anna', 'Bertil']).ok).toBe(false);
    expect(quorum([], ['Anna']).ok).toBe(true);
    const f = followUp([{ decision: 'Köp', owner: 'B', due_date: '2026-11-01', done_on: null }, { decision: '', owner: 'B', due_date: null, done_on: null }, { decision: 'X', owner: 'B', due_date: null, done_on: '2026-11-02' }], '2026-11-24');
    expect(f).toHaveLength(1); expect(f[0].overdue).toBe(true);
    const html = minutesHtml({ name: 'A & B AB', orgnr: '5566' }, { kind: 'board', date: '2026-11-24', place: '', chair: 'Anna', secretary: '', present: ['<Anna>'] }, [{ title: 'Punkt', decision: 'Ja', owner: '', due_date: null }]);
    expect(html).toContain('A &amp; B AB'); expect(html).toContain('&lt;Anna&gt;'); expect(html).not.toContain('<Anna>');
  });
});

import { costLines as trLines, latest, taxableBenefit, validUntil, validity } from '@/lib/trainings';
describe('Utbildning och behörigheter', () => {
  it('giltighet, förnyelse och förmån', () => {
    expect(validUntil('2021-12-15', 60)).toBe('2026-12-15');
    expect(validUntil('2021-12-15', null)).toBeNull();
    expect(validity('2026-12-15', '2026-11-24')).toEqual({ status: 'expiring', days: 21 });
    expect(validity('2026-11-01', '2026-11-24').status).toBe('expired');
    expect(validity('2027-06-01', '2026-11-24').status).toBe('valid');
    expect(validity(null, '2026-11-24').status).toBe('permanent');
    expect(latest([{ employee_id: 1, title: 'Heta arbeten', completed_on: '2021-01-01' }, { employee_id: 1, title: 'heta arbeten ', completed_on: '2026-11-01' }])).toHaveLength(1);
    expect(taxableBenefit(false, 200000)).toBe(200000);
    expect(taxableBenefit(true, 200000)).toBe(0);
    expect(trLines(350000)).toEqual([{ account: 7610, amount: 350000 }, { account: 1930, amount: -350000 }]);
  });
});

import { costPerMil, eventLines, reminders, tyreReminder } from '@/lib/vehicle-register';
describe('Fordonsregister', () => {
  it('påminnelser, kontering och kostnad per mil', () => {
    const r = reminders({ inspection_due: '2026-12-14', insurance_until: '2027-06-01', service_due_date: null, service_due_km: 15000 }, 14500, '2026-11-24');
    expect(r.map((x) => x.kind)).toEqual(['inspection', 'service_km']);
    expect(reminders({ inspection_due: '2026-11-01', insurance_until: null, service_due_date: null, service_due_km: 15000 }, 15100, '2026-11-24').every((x) => x.overdue)).toBe(true);
    expect(tyreReminder('2026-11-24')).toContain('vinterdäck');
    expect(tyreReminder('2026-04-10')).toContain('sommardäck');
    expect(tyreReminder('2026-07-01')).toBeNull();
    expect(eventLines('fuel', 80000, 20000)).toEqual([{ account: 5611, amount: 80000 }, { account: 2641, amount: 20000 }, { account: 1930, amount: -100000 }]);
    expect(eventLines('tax', 120000, 0)).toEqual([{ account: 5612, amount: 120000 }, { account: 1930, amount: -120000 }]);
    expect(costPerMil(550000, 500)).toBe(11000);
    expect(costPerMil(550000, 0)).toBeNull();
  });
});

import { calculate, costChange, suggestPrice } from '@/lib/product-costing';
describe('Produktkalkyl', () => {
  it('påläggskalkyl, täckningsbidrag och prisförslag', () => {
    const c = { materials: [{ qty: 1, unitCost: 150000 }, { qty: 4, unitCost: 10000 }, { qty: 1, unitCost: 10000 }], batchQty: 1, labourMinutes: 120, labourRate: 50000, mo: 10, to: 50, affo: 10 };
    expect(calculate(c, 500000)).toMatchObject({ material: 200000, labour: 100000, manufacturing: 370000, selfCost: 407000, variable: 300000, contribution: 200000, contributionPct: 40, margin: 18.6 });
    expect(calculate({ ...c, batchQty: 2 }, 500000).material).toBe(100000);
    expect(calculate(c, 0).margin).toBeNull();
    expect(suggestPrice(467500, 15)).toBe(550000);
    expect(suggestPrice(100001, 0)).toBe(100100);
    expect(costChange(407000, 467500)).toBe(14.9);
  });
});

import { caseCode, deadlines, normalizeCode, purgeAfter } from '@/lib/whistleblowing';
describe('Visselblåsarkanal', () => {
  it('ärendekod, frister och gallring', () => {
    const c = caseCode(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    expect(c).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(caseCode(new Uint8Array([255, 1, 2, 3, 4, 5, 6, 7, 8, 9]))).not.toBe(c);
    expect(normalizeCode(c.toLowerCase())).toBe(c.replace(/-/g, ''));
    const received = new Date('2026-11-01T10:00:00Z');
    const d = deadlines({ received_at: received, acknowledged_at: null, feedback_at: null, status: 'open' }, new Date('2026-11-09T10:00:00Z'));
    expect(d.ackOverdue).toBe(true); expect(d.feedbackOverdue).toBe(false);
    expect(d.feedbackBy.toISOString().slice(0, 10)).toBe('2027-02-01');
    expect(deadlines({ received_at: received, acknowledged_at: received, feedback_at: null, status: 'open' }, new Date('2027-02-02T10:00:00Z')).feedbackOverdue).toBe(true);
    expect(purgeAfter(new Date('2026-11-24T00:00:00Z')).toISOString().slice(0, 10)).toBe('2028-11-24');
  });
});

