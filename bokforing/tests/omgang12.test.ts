import { describe, expect, it } from 'vitest';
import { count, fmtRanges, issueEntries, normalize, ownership, take } from '@/lib/shares';

describe('Aktiebok', () => {
  it('nummerserier och överlåtelse', () => {
    expect(normalize([{ from: 501, to: 1000 }, { from: 1, to: 500 }])).toEqual([{ from: 1, to: 1000 }]);
    const t = take([{ from: 1, to: 300 }, { from: 501, to: 600 }], 350);
    expect(t.taken).toEqual([{ from: 1, to: 300 }, { from: 501, to: 550 }]);
    expect(t.left).toEqual([{ from: 551, to: 600 }]);
    expect(count(t.left)).toBe(50);
    expect(fmtRanges(t.taken)).toBe('1–300, 501–550');
    expect(() => take([{ from: 1, to: 10 }], 11)).toThrow();
  });
  it('nyemission bokas på ej registrerat aktiekapital och överkurs', () => {
    const e = issueEntries({ newShares: 100, pricePerShare: 50000, quota: 10000 });
    expect(e).toMatchObject({ total: 5000000, capital: 1000000, premium: 4000000 });
    expect(e.payment).toEqual([{ account: 1930, amount: 5000000 }, { account: 2082, amount: -1000000 }, { account: 2097, amount: -4000000 }]);
    expect(() => issueEntries({ newShares: 1, pricePerShare: 1, quota: 10000 })).toThrow();
  });
  it('kapital- och röstandel', () => {
    const o = ownership([{ key: 'x', a: 100, b: 0 }, { key: 'y', a: 0, b: 900 }]);
    expect(o[0].pct).toBe(10); expect(Math.round(o[0].votePct * 10) / 10).toBe(52.6);
  });
});

import { DEFAULT_CATEGORIES, emissions } from '@/lib/climate';
describe('Klimatbokföring', () => {
  it('schabloner per konto och scope', () => {
    const e = emissions({ costs: new Map([[5611, 1000000], [5020, 500000], [4010, 2000000], [1930, 999999]]), categories: DEFAULT_CATEGORIES, activities: [], privateKm: 0 });
    expect(e.byScope).toEqual({ 1: 2500, 2: 150, 3: 6000 });
    expect(e.rows[0].label).toBe('Inköp av varor och material');
  });
  it('exakta värden ersätter schablonen för samma kategori', () => {
    const e = emissions({ costs: new Map([[5611, 1000000], [5020, 500000]]), categories: DEFAULT_CATEGORIES, activities: [{ kind: 'diesel_l', quantity: 500 }], privateKm: 1000 });
    expect(e.byScope[1]).toBe(1300);
    expect(e.rows.find((r) => r.key === 'car')!.kg).toBe(120);
    expect(e.total).toBe(1300 + 150 + 120);
  });
});

import { creditUse, factoringLines, paymentLines, schedule } from '@/lib/loans';
describe('Lån och finansiering', () => {
  it('rak amortering', () => {
    const s = schedule({ principal: 12000000, ratePct: 6, firstDate: '2026-01-31', months: 12, type: 'straight' });
    expect(s[0]).toEqual({ n: 1, date: '2026-01-31', interest: 60000, amortization: 1000000, payment: 1060000, balance: 11000000 });
    expect(s[1].date).toBe('2026-02-28');
    expect(s[11].balance).toBe(0);
  });
  it('annuitet: lika stora betalningar', () => {
    const s = schedule({ principal: 10000000, ratePct: 5, firstDate: '2026-01-25', months: 24, type: 'annuity' });
    expect(new Set(s.slice(0, 23).map((r) => r.payment)).size).toBeLessThanOrEqual(2);
    expect(s[23].balance).toBe(0);
    expect(s.reduce((x, r) => x + r.amortization, 0)).toBe(10000000);
  });
  it('bokföring', () => {
    expect(paymentLines({ interest: 60000, amortization: 1000000 }, 2350)).toEqual([{ account: 8410, amount: 60000 }, { account: 2350, amount: 1000000 }, { account: 1930, amount: -1060000 }]);
    expect(factoringLines({ invoiceAmount: 100000, advance: 97000, fee: 3000 })).toEqual([{ account: 1930, amount: 97000 }, { account: 6064, amount: 3000 }, { account: 1689, amount: -100000 }]);
    expect(creditUse(10000000, -2500000)).toEqual({ used: 2500000, left: 7500000, pct: 25 });
  });
});

import { ossCountry, ossDeclaration, ossDue, psSkvFile } from '@/lib/oss';
import { computeInvoice, invoiceBookingLines } from '@/lib/invoice';
describe('Moms för e-handel inom EU', () => {
  it('OSS gäller privatpersoner i andra EU-länder för registrerade bolag', () => {
    expect(ossCountry({ registered: true, country: 'de', vatNumber: '', reverseCharge: false })).toBe('DE');
    expect(ossCountry({ registered: true, country: 'DE', vatNumber: 'DE123', reverseCharge: false })).toBeNull();
    expect(ossCountry({ registered: false, country: 'DE', vatNumber: '', reverseCharge: false })).toBeNull();
    expect(ossCountry({ registered: true, country: 'NO', vatNumber: '', reverseCharge: false })).toBeNull();
  });
  it('faktura med köparlandets moms bokas på OSS-kontot', () => {
    const lines = [{ description: 'Vara', quantity: 2, unit: 'st', unitPrice: 10000, vatRate: 25 as const, account: 3109, ossRate: 25.5 }];
    const t = computeInvoice(lines, { roundToKrona: false });
    expect(t.vat).toBe(5100);
    expect(invoiceBookingLines(lines, t).find((l) => l.account === 2670)).toMatchObject({ credit: 5100 });
    expect(invoiceBookingLines(lines, t).some((l) => l.account === 2611)).toBe(false);
  });
  it('deklaration, förfallodag och Skatteverkets fil', () => {
    expect(ossDeclaration([{ country: 'DE', rate: 19, base: 100, vat: 19 }, { country: 'DE', rate: 19, base: 200, vat: 38 }, { country: 'FI', rate: 25.5, base: 100, vat: 26 }]))
      .toEqual({ rows: [{ country: 'DE', rate: 19, base: 300, vat: 57 }, { country: 'FI', rate: 25.5, base: 100, vat: 26 }], base: 400, vat: 83 });
    expect(ossDue(2026, 4)).toBe('2027-01-31'); expect(ossDue(2026, 1)).toBe('2026-04-30');
    expect(psSkvFile({ vatNumber: 'SE556026998601', period: '2026-Q4', contact: 'Ägare;T', phone: '070', email: 'a@b.se', rows: [{ vatNumber: 'DE123456789', goods: 1000, services: 0 }] }))
      .toBe('SKV574008;\r\nSE556026998601;26-4;Ägare T;070;a@b.se\r\nDE123456789;1000;;\r\n');
  });
});

import { chargeAmount, duePeriods, normOrg, reconcilePair } from '@/lib/intercompany';
describe('Koncerninterna flöden', () => {
  it('avstämning och avgifter', () => {
    expect(normOrg('16556026-9986')).toBe('5560269986');
    expect(reconcilePair({ receivable: 100000, payable: 100000 }).ok).toBe(true);
    expect(reconcilePair({ receivable: 100000, payable: 90000 })).toEqual({ diff: 10000, ok: false });
    expect(chargeAmount({ kind: 'interest', amount: null, principal: 120000000, ratePct: 5 })).toBe(500000);
    expect(chargeAmount({ kind: 'management_fee', amount: 2500000, principal: null, ratePct: null })).toBe(2500000);
  });
  it('perioder att fakturera', () => {
    expect(duePeriods(null, '2026-10', '2026-11')).toEqual(['2026-10', '2026-11']);
    expect(duePeriods('2026-11', '2026-01', '2026-11')).toEqual([]);
    expect(duePeriods('2026-11', '2026-01', '2027-01')).toEqual(['2026-12', '2027-01']);
  });
});
