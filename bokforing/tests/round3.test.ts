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
