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

import { billingPeriod, deductibleShare, depositReturnLines, indexedRent, periodRent, splitComponents, DEFAULT_COMPONENTS } from '@/lib/property';
describe('Fastighet', () => {
  it('perioder för avier', () => {
    expect(billingPeriod('month', '2026-02')).toMatchObject({ key: '2026-02', from: '2026-02-01', to: '2026-02-28', months: 1 });
    expect(billingPeriod('quarter', '2026-04')).toMatchObject({ key: '2026-Q2', from: '2026-04-01', to: '2026-06-30', months: 3 });
    expect(billingPeriod('quarter', '2026-05')).toBeNull();
  });
  it('indexuppräkning och periodhyra', () => {
    expect(indexedRent({ baseRent: 12000000, baseIndex: 400, index: 420, share: 100 })).toBe(12600000);
    expect(indexedRent({ baseRent: 12000000, baseIndex: 400, index: 420, share: 75 })).toBe(12450000);
    expect(indexedRent({ baseRent: 12000000, baseIndex: 400, index: 390, share: 100 })).toBe(12000000);
    expect(indexedRent({ baseRent: 12000000, baseIndex: null, index: 420, share: 100 })).toBe(12000000);
    expect(periodRent(12600000, 3)).toBe(3150000);
  });
  it('avdragsrätt efter momspliktig yta', () => {
    expect(deductibleShare([{ area: 300, vatLiable: true, let: true }, { area: 100, vatLiable: false, let: true }, { area: 500, vatLiable: true, let: false }])).toBe(75);
  });
  it('deposition och komponenter', () => {
    expect(depositReturnLines({ deposit: 3000000, retained: 500000, bank: 1930 })).toEqual([{ account: 2891, amount: 3000000 }, { account: 1930, amount: -2500000 }, { account: 3990, amount: -500000 }]);
    expect(() => depositReturnLines({ deposit: 100, retained: 200, bank: 1930 })).toThrow();
    const s = splitComponents(1000000000, 200000000, DEFAULT_COMPONENTS);
    expect(s.building).toBe(800000000);
    expect(s.components.reduce((a, c) => a + c.cost, 0)).toBe(800000000);
    expect(s.components[0]).toMatchObject({ cost: 400000000, lifeMonths: 1200 });
    expect(s.yearlyDepreciation).toBe(4000000 + 1600000 + 1920000 + 4000000 + 3200000);
    expect(() => splitComponents(100, 0, [{ name: 'x', pct: 90, years: 10 }])).toThrow();
  });
});

import { cashFlow, deferredTax, deferredTaxEntry, k3Changes } from '@/lib/cashflow';
describe('Kassaflödesanalys och K3', () => {
  it('indirekt metod stämmer mot likvida medel', () => {
    // Försäljning 100 000 på kredit (1510/3010), kund betalar 60 000, avskrivning 10 000, lån 50 000, investering 80 000, skatt 5 000 betald
    const v: [number, number][][] = [
      [[1510, 12500000], [3010, -10000000], [2610, -2500000]],
      [[1930, 6000000], [1510, -6000000]],
      [[7832, 1000000], [1229, -1000000]],
      [[1930, 5000000], [2350, -5000000]],
      [[1220, 8000000], [1930, -8000000]],
      [[8910, 500000], [2510, -500000]], [[2510, 500000], [1930, -500000]],
      [[2091, 2000000], [2898, -2000000]], [[2898, 2000000], [1930, -2000000]],
    ];
    const m = new Map<number, number>();
    for (const vv of v) for (const [a, x] of vv) m.set(a, (m.get(a) ?? 0) + x);
    const c = cashFlow(m);
    expect(c.cashChange).toBe(500000);
    expect(c.change).toBe(c.cashChange);
    expect(c.operating.find((l) => l.key === 'result')!.amount).toBe(9000000);
    expect(c.operating.find((l) => l.key === 'depreciation')!.amount).toBe(1000000);
    expect(c.operating.find((l) => l.key === 'tax')!.amount).toBe(-500000);
    expect(c.workingCapital.find((l) => l.key === 'receivables')!.amount).toBe(-6500000);
    expect(c.workingCapital.find((l) => l.key === 'liabilities')!.amount).toBe(2500000);
    expect(c.investingTotal).toBe(-8000000);
    expect(c.financing.find((l) => l.key === 'loans')!.amount).toBe(5000000);
    expect(c.financing.find((l) => l.key === 'equity')!.amount).toBe(-2000000);
  });
  it('realisationsvinst flyttas till investeringsverksamheten', () => {
    // Inventarie (anskaffning 50 000, ack avskr 30 000) säljs för 25 000: vinst 5 000
    const m = new Map([[1930, 2500000], [1229, 3000000], [1220, -5000000], [3973, -500000]]);
    const c = cashFlow(m);
    expect(c.operating.find((l) => l.key === 'gains')!.amount).toBe(-500000);
    expect(c.investingTotal).toBe(2500000);
    expect(c.change).toBe(2500000);
  });
  it('uppskjuten skatt', () => {
    const d = deferredTax([{ label: 'Byggnad', amount: 10000000 }, { label: 'Underskott', amount: -5000000 }]);
    expect(d).toMatchObject({ liability: 2060000, asset: 1030000, net: 1030000 });
    expect(deferredTaxEntry(d, { liability: 0, asset: 0 })).toEqual([{ account: 2240, amount: -2060000 }, { account: 1370, amount: 1030000 }, { account: 8940, amount: 1030000 }]);
    expect(deferredTaxEntry(d, { liability: 2060000, asset: 1030000 })).toEqual([]);
    expect(k3Changes({ buildingsWithoutComponents: 2, untaxedReserves: 1, hasCashFlow: true, larger: false }).map((c) => c.title)).toContain('Komponentavskrivning');
  });
});

import { allocate, decisionLines, importVat, landedAverage, reconcile } from '@/lib/customs';
import { vatReport } from '@/lib/vat';
describe('Import och tull', () => {
  it('underlag och moms enligt beslutet, rutorna 50/60/48', () => {
    const d = { customsValue: 10000000, duty: 1200000, fees: 50000, freightSweden: 250000, vatRate: 25 as const };
    expect(importVat(d)).toEqual({ base: 11500000, vat: 2875000 });
    const lines = decisionLines(d);
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(0);
    const r = vatReport(new Map(lines.map((l) => [l.account, l.amount])));
    const box = (b: string) => r.boxes.find((x) => x.box === b)?.amount;
    expect([box('50'), box('60'), box('48'), box('30')]).toEqual([11500000, 2875000, 2875000, 0]);
    expect(r.toPay).toBe(0);
    expect(decisionLines(d, false).find((l) => l.account === 2645)).toBeUndefined();
  });
  it('omvänd moms 12 % hamnar i ruta 31, inte 11', () => {
    const r = vatReport(new Map([[2624, -12000], [2645, 12000]]));
    expect(r.boxes.find((x) => x.box === '31')?.amount).toBe(12000);
    expect(r.boxes.find((x) => x.box === '11')?.amount).toBe(0);
  });
  it('fördelning på varor och nytt snittpris', () => {
    const a = allocate([{ id: 1, qty: 100, value: 3000000 }, { id: 2, qty: 50, value: 1000000 }], 1250000);
    expect(a.map((x) => x.allocated)).toEqual([937500, 312500]);
    expect(a[0].unitExtra).toBe(9375);
    expect(landedAverage({ onHand: 100, avgCost: 30000, received: 100, allocated: 937500 })).toEqual({ avgCost: 39375, toInventory: 937500 });
    expect(landedAverage({ onHand: 40, avgCost: 30000, received: 100, allocated: 1000000 })).toEqual({ avgCost: 40000, toInventory: 400000 });
    expect(reconcile({ decisions: 100, booked: 100, statement: 90 })).toMatchObject({ ok: false, diffStatement: -10 });
  });
});
