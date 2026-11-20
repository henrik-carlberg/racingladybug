import { describe, expect, it } from 'vitest';
import { auditReportHtml, giftLines, memberStats, membersToInvoice, noticeDeadline, noticeHtml, DEFAULT_AGENDA } from '@/lib/association';

const M = (id: number, category: string, joined: string, left_on: string | null = null) => ({ id, name: `M${id}`, category, joined, left_on });

describe('Föreningar', () => {
  it('aviserar aktiva medlemmar med avgift för kategorin', () => {
    const members = [M(1, 'Ordinarie', '2020-01-01'), M(2, 'Ungdom', '2026-05-01'), M(3, 'Ordinarie', '2019-01-01', '2025-06-30'), M(4, 'Hedersmedlem', '2010-01-01'), M(5, 'Ordinarie', '2027-01-10')];
    const due = membersToInvoice(members, [{ category: 'Ordinarie', amount: 30000 }, { category: 'Ungdom', amount: 10000 }], 2026, new Set([2]));
    expect(due.map((d) => [d.member.id, d.amount])).toEqual([[1, 30000]]);
    expect(membersToInvoice(members, [{ category: 'Ordinarie', amount: 30000 }], 2026, new Set()).map((d) => d.member.id)).toEqual([1]);
    expect(membersToInvoice([M(6, 'Ordinarie', '2020-01-01', '2026-09-01')], [{ category: 'Ordinarie', amount: 1 }], 2026, new Set(), '2026-10-01')).toEqual([]);
    expect(membersToInvoice([M(6, 'Ordinarie', '2020-01-01', '2026-09-01')], [{ category: 'Ordinarie', amount: 1 }], 2026, new Set(), '2026-02-01')).toHaveLength(1);
  });
  it('medlemsstatistik', () => {
    const s = memberStats([M(1, 'A', '2020-01-01'), M(2, 'B', '2026-02-01'), M(3, 'A', '2020-01-01', '2026-03-01')], 2026);
    expect(s).toEqual({ total: 2, joined: 1, left: 1, byCategory: [['A', 1], ['B', 1]] });
  });
  it('gåva och bidrag bokas mot bank', () => {
    expect(giftLines({ kind: 'gift', amount: 50000, bank: 1930, restricted: false })).toEqual([{ account: 1930, amount: 50000 }, { account: 3985, amount: -50000 }]);
    expect(giftLines({ kind: 'grant', amount: 100, bank: 1940, restricted: true })[1].account).toBe(3980);
  });
  it('kallelse och revisionsberättelse', () => {
    expect(noticeDeadline('2027-03-15')).toBe('2027-03-01');
    expect(noticeDeadline('2027-03-15', 3)).toBe('2027-02-22');
    const h = noticeHtml({ org: 'IK <Test>', year: 2026, date: '2027-03-15', time: '18:00', place: 'Klubbhuset', agenda: DEFAULT_AGENDA, extra: '' });
    expect(h).toContain('IK &lt;Test&gt;');
    expect(h).toContain('<li>Val av revisorer</li>');
    expect(auditReportHtml({ org: 'IK', orgnr: '', year: 2026, auditors: ['Anna'], remarks: '' })).toContain('ansvarsfrihet');
  });
});
