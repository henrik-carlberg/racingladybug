import { describe, expect, it } from 'vitest';
import { convertTotals, fxPaymentLines, invoiceBookingLines, invoiceTotals } from '@/lib/invoice';
import { ossSummary, periodicSummary, periodRange, periodicSummaryCsv } from '@/lib/eu';
import type { Line } from '@/lib/ledger-lines';

const sum = (ls: Line[], acc: number) => ls.filter((l) => l.account === acc).reduce((s, l) => s + l.debit - l.credit, 0);
const balanced = (ls: Line[]) => ls.reduce((s, l) => s + l.debit - l.credit, 0) === 0;

describe('fakturor i utländsk valuta', () => {
  const lines = [{ description: 'Consulting', quantity: 10, unit: 'h', unitPrice: 12345, vatRate: 25 as const, account: 3308 }];
  it('dokumentet i euro utan kronavrundning, bokföringen i kronor', () => {
    const t = invoiceTotals(lines, { reverseCharge: true, currency: 'EUR', rate: '11.2345' });
    expect(t.doc.total).toBe(123450);
    expect(t.doc.rounding).toBe(0);
    expect(t.sek.total).toBe(Math.round(123450 * 11.2345));
    const b = invoiceBookingLines(lines, t.sek);
    expect(balanced(b)).toBe(true);
    expect(sum(b, 1510)).toBe(t.sek.total);
  });
  it('moms omräknas per sats och öresdiff blir avrundning', () => {
    const t = convertTotals({ net: 1001, vat: 250, vatByRate: { 25: { base: 1001, vat: 250 } }, rounding: 0, total: 1251, lineNets: [1001] }, 1.5);
    expect(t.net + t.vat + t.rounding).toBe(t.total);
  });
  it('kursvinst och kursförlust vid betalning', () => {
    const gain = fxPaymentLines(100000, 101500, 1930);
    expect(balanced(gain)).toBe(true);
    expect(sum(gain, 3960)).toBe(-1500);
    const loss = fxPaymentLines(100000, 99000, 1930);
    expect(sum(loss, 7960)).toBe(1000);
    // Leverantör: betalat mer än skulden = förlust
    const sup = fxPaymentLines(100000, 102000, 1930, 2440, -1);
    expect(balanced(sup)).toBe(true);
    expect(sum(sup, 1930)).toBe(-102000);
    expect(sum(sup, 2440)).toBe(100000);
    expect(sum(sup, 7960)).toBe(2000);
    expect(sum(fxPaymentLines(100000, 97000, 1930, 2440, -1), 3960)).toBe(-3000);
  });
});

describe('EU-rapporter', () => {
  const l = (o: Partial<Parameters<typeof periodicSummary>[0][number]>) => ({ vatNumber: 'DE123456789', country: 'DE', customer: 'GmbH', account: 3308, amountSek: 100000, consumer: false, ...o });
  it('periodisk sammanställning per momsnummer i hela kronor', () => {
    const ps = periodicSummary([l({}), l({ account: 3106, amountSek: 50050 }), l({ vatNumber: 'fi 1234567 8', customer: 'Oy', amountSek: 20000 }), l({ vatNumber: '', customer: 'Okänd' }), l({ account: 3001 })]);
    expect(ps.rows).toEqual([{ vatNumber: 'DE123456789', customer: 'GmbH', goods: 501, services: 1000 }, { vatNumber: 'FI12345678', customer: 'Oy', goods: 0, services: 200 }]);
    expect(ps.missing).toEqual(['Okänd']);
    expect(periodicSummaryCsv({ vatNumber: 'SE556677889901', period: '2026-Q4', rows: ps.rows })).toContain('SE556677889901;2026-Q4;DE123456789;501;0;1000');
  });
  it('OSS-tröskeln', () => {
    expect(ossSummary([l({ consumer: true, country: 'FR', amountSek: 5_000_000 }), l({ consumer: true, country: 'NO', amountSek: 9_000_000 })]).overThreshold).toBe(false);
    expect(ossSummary([l({ consumer: true, amountSek: 10_000_000 })]).overThreshold).toBe(true);
  });
  it('perioder', () => {
    expect(periodRange('2026-Q4')).toEqual({ from: '2026-10-01', to: '2026-12-31', label: '2026 kvartal 4' });
    expect(periodRange('2026-02')?.to).toBe('2026-02-28');
    expect(periodRange('2026-13')).toBeNull();
  });
});

import { change, groupSums, highlights } from '@/lib/monthly';
describe('månadsrapport', () => {
  it('grupperar resultatkonton', () => {
    const g = groupSums(new Map([[3001, -1000000], [4010, 200000], [5010, 100000], [7210, 300000], [7832, 50000], [8310, -1000]]));
    expect(g).toMatchObject({ revenue: 1000000, goods: 200000, external: 100000, staff: 300000, depreciation: 50000, financial: 1000, result: 351000 });
  });
  it('förändring och iakttagelser', () => {
    expect(change(120, 100)).toBe(20);
    expect(change(5, 0)).toBeNull();
    const h = highlights({ revenue: 150000, revenuePrev: 100000, result: -5000, cash: 10000, cashPrev: 20000, overdue: 30000, overdueCount: 2, vatDue: 0 });
    expect(h[0]).toContain('ökade med 50 %');
    expect(h.join(' ')).toContain('förlust');
    expect(h.join(' ')).toContain('2 kundfakturor är förfallna');
  });
});

import { consolidate, orgDigits } from '@/lib/consolidation';
describe('koncernsammanställning', () => {
  it('summerar och eliminerar koncerninternt', () => {
    const r = consolidate([
      { id: 1, name: 'Moder AB', result: new Map([[3001, -1000000], [5010, 200000]]), balance: new Map([[1930, 500000], [1510, 300000], [2098, -800000]]), intraSales: 100000, intraOpen: 50000 },
      { id: 2, name: 'Dotter AB', result: new Map([[3001, -400000], [6550, 100000]]), balance: new Map([[1930, 100000], [2440, -50000], [2098, -50000]]), intraSales: 0, intraOpen: 0 },
    ]);
    expect(r.result.revenue).toBe(1300000);
    expect(r.result.external).toBe(200000);
    expect(r.consolidatedResult).toBe(1100000);
    expect(r.balance.current).toBe(250000);
    expect(r.balance.shortterm).toBe(0);
    expect(r.balance.cash).toBe(600000);
  });
  it('organisationsnummer jämförs utan bindestreck och sekelsiffror', () => {
    expect(orgDigits('556677-8899')).toBe(orgDigits('165566778899'));
  });
});

import { carBenefitMonthly, carBenefitYearly, pensionCost, percentRuleVacation } from '@/lib/payroll-extras';
describe('lönetillägg', () => {
  it('bilförmån enligt schablonen', () => {
    // 400 000 kr bil, pbb 59 200, SLR 2,55 %, fordonsskatt 1 500
    const y = carBenefitYearly({ newCarPrice: 40_000_000, vehicleTax: 150_000, pbb: 5_920_000, slr: 2.55 });
    const expected = 0.29 * 59200 + 400000 * (0.7 * 0.0255 + 0.01) + 0.13 * 400000 + 1500;
    expect(y / 100).toBe(Math.round(expected));
    expect(carBenefitMonthly(y)).toBe(Math.round(y / 12 / 100) * 100);
  });
  it('tjänstepension och särskild löneskatt', () => {
    expect(pensionCost(3_500_000, 4.5)).toEqual({ premium: 157_500, slp: Math.round(157_500 * 0.2426) });
    expect(pensionCost(3_500_000, 0).premium).toBe(0);
  });
  it('semesterlön enligt procentregeln', () => {
    const v = percentRuleVacation({ earnedLastYear: 30_000_000, paidDays: 25, daysTaken: 5, monthly: 0 });
    expect(v.dayPay).toBe(144_000);
    expect(v.pay).toBe(720_000);
    expect(v.deduction).toBe(0);
    expect(percentRuleVacation({ earnedLastYear: 42_000_000, paidDays: 25, daysTaken: 2, monthly: 3_500_000 }).deduction).toBe(322_000);
  });
});
