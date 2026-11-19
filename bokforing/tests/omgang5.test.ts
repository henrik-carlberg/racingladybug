import { describe, expect, it } from 'vitest';
import { receiptKey, sameCoding, splitVat, vatRateOf } from '@/lib/coding-memory';
import { monthlyPattern, nextMonthDay, normText, ordinal } from '@/lib/patterns';
import { dateChecks, supplierInvoiceChecks, voucherChecks, type Period } from '@/lib/checks';

const period: Period = { lockedUntil: '2026-06-30', fiscalYears: [{ start: '2026-01-01', end: '2026-12-31', closed: false }, { start: '2025-01-01', end: '2025-12-31', closed: true }] };

describe('inlärd kontering', () => {
  it('känner igen momssatsen', () => {
    expect(vatRateOf(125000, 25000)).toBe(25);
    expect(vatRateOf(11200, 1200)).toBe(12);
    expect(vatRateOf(10600, 600)).toBe(6);
    expect(vatRateOf(10000, 0)).toBe(0);
    expect(vatRateOf(10000, 1500)).toBeNull();
  });
  it('delar upp belopp inkl. moms', () => expect(splitVat(250000, 25)).toEqual({ net: 200000, vat: 50000 }));
  it('nyckel för kvitton: butiken före kolon', () => {
    expect(receiptKey('Pressbyrån Centralen: kaffe')).toBe('pressbyrån centralen');
    expect(receiptKey('  ICA Maxi!! ')).toBe('ica maxi');
  });
  it('samma kontering oavsett ordning', () => {
    expect(sameCoding({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(sameCoding({ a: 1 }, { a: 2 })).toBe(false);
  });
});

describe('mönster', () => {
  it('hittar månadsmönster och nästa datum', () => {
    expect(monthlyPattern(['2026-08-25', '2026-09-25', '2026-10-24'])).toEqual({ day: 25, last: '2026-10-24', next: '2026-11-25' });
    expect(monthlyPattern(['2026-08-25', '2026-09-25'])).toBeNull();
    expect(monthlyPattern(['2026-06-01', '2026-08-01', '2026-09-01'])).toBeNull();
  });
  it('kort månad ger sista dagen', () => expect(nextMonthDay('2026-01-31', 31)).toBe('2026-02-28'));
  it('samma text oavsett månad och siffror', () => expect(normText('Hyra förråd oktober 2026')).toBe(normText('Hyra förråd november')));
  it('ordningstal', () => { expect(ordinal(1)).toBe('1:a'); expect(ordinal(25)).toBe('25:e'); expect(ordinal(22)).toBe('22:a'); expect(ordinal(11)).toBe('11:e'); });
});

describe('kontroller', () => {
  it('låst period, stängt år och saknat år stoppar', () => {
    expect(dateChecks('2026-05-01', period, '2026-11-19')[0].level).toBe('error');
    expect(dateChecks('2025-05-01', period, '2026-11-19').some((c) => c.text.includes('avslutat'))).toBe(true);
    expect(dateChecks('2027-05-01', period, '2026-11-19').some((c) => c.text.includes('inget räkenskapsår'))).toBe(true);
    expect(dateChecks('2026-11-01', period, '2026-11-19')).toEqual([]);
  });
  it('leverantörsfaktura: dubblett, ovanligt belopp, moms på momsfritt konto', () => {
    const history = { count: 5, median: 100000, numbers: ['A-1'], recent: [{ date: '2026-11-01', total: 125000 }] };
    const base = { today: '2026-11-19', period, history, invoiceDate: '2026-11-10' };
    expect(supplierInvoiceChecks({ ...base, total: 125000, vat: 25000, account: 5410, invoiceNumber: 'A-1' }).map((c) => c.level)).toEqual(['error', 'warn']);
    expect(supplierInvoiceChecks({ ...base, total: 1000000, vat: 200000, account: 5410, invoiceNumber: 'B' })[0].text).toContain('ovanligt högt');
    expect(supplierInvoiceChecks({ ...base, total: 125000 + 1, vat: 25000, account: 6310, invoiceNumber: 'B' })[0].text).toContain('normalt ingen moms');
    expect(supplierInvoiceChecks({ ...base, total: 50000, vat: 0, account: 5410, invoiceNumber: 'B' })[0].level).toBe('info');
  });
  it('verifikation: momsen jämförs med kostnaden', () => {
    const lines = [{ account: 5410, debit: 100000, credit: 0 }, { account: 2640, debit: 20000, credit: 0 }, { account: 1930, debit: 0, credit: 120000 }];
    expect(voucherChecks({ date: '2026-11-10', lines, today: '2026-11-19', period })[0].text).toContain('20 %');
    const ok = [{ account: 5410, debit: 100000, credit: 0 }, { account: 2640, debit: 25000, credit: 0 }, { account: 1930, debit: 0, credit: 125000 }];
    expect(voucherChecks({ date: '2026-11-10', lines: ok, today: '2026-11-19', period })).toEqual([]);
  });
});

import { validPushEndpoint, validPushKeys } from '@/lib/push';
describe('pushnotiser', () => {
  it('bara kända pushtjänster över https', () => {
    expect(validPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(validPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(validPushEndpoint('https://web.push.apple.com/QG')).toBe(true);
    expect(validPushEndpoint('https://evil.example/push')).toBe(false);
    expect(validPushEndpoint('https://fcm.googleapis.com:8443/x')).toBe(false);
    expect(validPushEndpoint('http://fcm.googleapis.com/x')).toBe(false);
    expect(validPushEndpoint('https://u:p@fcm.googleapis.com/x')).toBe(false);
    expect(validPushEndpoint('http://localhost:3306/x')).toBe(false);
    expect(validPushEndpoint('http://localhost:3306/x', true)).toBe(true);
    expect(validPushEndpoint('http://10.0.0.1/x', true)).toBe(false);
  });
  it('nycklarnas längd', () => {
    expect(validPushKeys(Buffer.alloc(65, 4).toString('base64url'), Buffer.alloc(16).toString('base64url'))).toBe(true);
    expect(validPushKeys('abc', Buffer.alloc(16).toString('base64url'))).toBe(false);
  });
});
