import { describe, expect, it } from 'vitest';
import { assessRisk, engagementLetter, kycStatus, parseOwners } from '@/lib/kyc';

describe('Kundkännedom', () => {
  it('risknivå och omprövning', () => {
    expect(assessRisk([], false, '2026-11-20')).toMatchObject({ risk: 'low', nextReview: '2028-11-20' });
    expect(assessRisk(['cash'], false, '2026-11-20')).toMatchObject({ risk: 'normal', nextReview: '2027-11-20' });
    expect(assessRisk(['cash', 'unusual'], false, '2026-11-20')).toMatchObject({ risk: 'high', nextReview: '2027-05-20', enhanced: true });
    expect(assessRisk([], true, '2026-08-31')).toMatchObject({ risk: 'high', nextReview: '2027-02-28' });
  });
  it('status', () => {
    expect(kycStatus(null, '2026-11-20')).toBe('missing');
    expect(kycStatus('2026-11-01', '2026-11-20')).toBe('expired');
    expect(kycStatus('2026-12-10', '2026-11-20')).toBe('due');
    expect(kycStatus('2027-06-01', '2026-11-20')).toBe('ok');
  });
  it('verkliga huvudmän och uppdragsbrev', () => {
    expect(parseOwners({ huvudman: [{ namn: 'Ägare Testsson', fodelsear: 1980, omfattning: 'Mer än 75 %', grund: 'Ägande' }, { foo: 1 }] }))
      .toEqual([{ name: 'Ägare Testsson', birthYear: 1980, share: 'Mer än 75 %', basis: 'Ägande' }]);
    const h = engagementLetter({ firm: 'Byrå <AB>', firmOrgnr: '', client: 'Kund', clientOrgnr: '1', services: ['bookkeeping', 'vat'], fee: '1 000 kr/mån', start: '2026-12-01', date: '2026-11-20' });
    expect(h).toContain('Byrå &lt;AB&gt;'); expect(h).toContain('<li>Momsdeklarationer</li>'); expect(h).toContain('Penningtvättslagen');
  });
});

import { bankChanges, duplicateOf, isWeekend, normInvoiceNo, unusualPayments } from '@/lib/fraud';
describe('Bedrägeri- och felskydd', () => {
  it('ändrade bankuppgifter', () => {
    expect(bankChanges({ bankgiro: '555-1234', plusgiro: '', bank_account: '' }, { bankgiro: '5551234', plusgiro: '12345-6' })).toEqual({});
    expect(bankChanges({ bankgiro: '555-1234', plusgiro: '', bank_account: '' }, { bankgiro: '999-8888' })).toEqual({ bankgiro: '999-8888' });
  });
  it('dubbletter', () => {
    expect(normInvoiceNo('F-000123 ')).toBe('F000123');
    expect(normInvoiceNo('000123')).toBe('123');
    const e = [{ id: 1, supplierId: 5, number: '123', date: '2026-11-01', total: 50000, reference: '' }];
    expect(duplicateOf({ id: 2, supplierId: 5, number: '0123', date: '2026-11-20', total: 1, reference: '' }, e)).toEqual({ id: 1, reason: 'samma fakturanummer' });
    expect(duplicateOf({ id: 2, supplierId: 5, number: '124', date: '2026-11-05', total: 50000, reference: '' }, e)?.reason).toBe('samma belopp och nästan samma datum');
    expect(duplicateOf({ id: 2, supplierId: 5, number: '124', date: '2026-12-20', total: 50000, reference: '' }, e)).toBeNull();
  });
  it('ovanliga utbetalningar', () => {
    const rows = [1, 2, 3].map((i) => ({ id: i, date: `2026-0${i}-01`, amount: -100000, counterparty: 'Hyresvärden AB' }))
      .concat([{ id: 4, date: '2026-04-01', amount: -500000, counterparty: 'Hyresvärden AB' }, { id: 5, date: '2026-04-02', amount: -2000000, counterparty: 'Okänd Mottagare' }]);
    expect(unusualPayments(rows).map((x) => [x.id, x.kind])).toEqual([[4, 'large'], [5, 'new_recipient']]);
    expect(isWeekend(new Date('2026-11-21T12:00:00Z'))).toBe(true);
  });
});

import { chooseChannel, invoicePdf, mapKivraStatus, recipientId } from '@/lib/kivra';
import { pdfText } from '@/lib/doc-text';
describe('Kivra och digital post', () => {
  it('personnummer eller organisationsnummer', () => {
    expect(recipientId('19800101-0019')).toEqual({ type: 'person', ssn: '198001010019' });
    expect(recipientId('556026-9986')).toEqual({ type: 'company', vat: 'SE556026998601' });
    expect(recipientId('123')).toBeNull();
  });
  it('kanalval', () => {
    expect(chooseChannel({ preferred: 'auto', peppol: true, kivra: true, email: true })).toBe('peppol');
    expect(chooseChannel({ preferred: 'auto', peppol: false, kivra: true, email: true })).toBe('kivra');
    expect(chooseChannel({ preferred: 'email', peppol: true, kivra: true, email: true })).toBe('email');
    expect(chooseChannel({ preferred: 'kivra', peppol: false, kivra: false, email: false })).toBe('paper');
    expect(mapKivraStatus('READ')).toBe('read');
  });
  it('fakturans PDF är läsbar', () => {
    const pdf = invoicePdf({ company: 'Testbolaget AB', orgnr: '556026-9986', address: '', number: 1009, date: '2026-11-01', due: '2026-12-01', customer: 'Kund (privat)', customerAddress: 'Storgatan 1',
      lines: [{ description: 'Målning', quantity: 2, unit: 'h', price: 50000, amount: 100000 }], net: 100000, vat: 25000, total: 125000, bankgiro: '123-4567', ocr: '10094', link: 'https://x/f/t', credit: false });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const t = pdfText(pdf);
    expect(t).toContain('Faktura 1009'); expect(t).toContain('Kund (privat)'); expect(t).toContain('med OCR 10094');
  });
});

import { contractDates, contractState, priceIncrease, threeWayMatch } from '@/lib/purchasing';
describe('Inköp med matchning', () => {
  it('trevägsmatchning', () => {
    const lines = [{ qty: 10, received: 10, unit_price: 10000 }];
    expect(threeWayMatch({ lines, invoiceNet: 100000 }).status).toBe('matched');
    expect(threeWayMatch({ lines, invoiceNet: 100900 }).status).toBe('matched');
    expect(threeWayMatch({ lines, invoiceNet: 120000 }).status).toBe('price_diff');
    expect(threeWayMatch({ lines: [{ qty: 10, received: 6, unit_price: 10000 }], invoiceNet: 100000 }).status).toBe('qty_diff');
    expect(threeWayMatch({ lines: [{ qty: 10, received: 0, unit_price: 10000 }], invoiceNet: 100000 }).status).toBe('no_receipt');
  });
  it('avtal: uppsägningstid och automatisk förlängning', () => {
    expect(contractDates({ end: '2026-12-31', noticeMonths: 3, autoRenew: false, renewMonths: 0 }, '2026-11-20')).toEqual({ end: '2026-12-31', noticeBy: '2026-09-30', renewed: 0 });
    expect(contractDates({ end: '2026-12-31', noticeMonths: 3, autoRenew: true, renewMonths: 12 }, '2026-11-20')).toEqual({ end: '2027-12-31', noticeBy: '2027-09-30', renewed: 1 });
    expect(contractState({ end: '2027-01-31', noticeBy: '2026-12-31' }, '2026-11-20')).toBe('notice_soon');
    expect(contractState({ end: '2027-12-31', noticeBy: '2027-09-30' }, '2026-11-20')).toBe('active');
  });
  it('prishöjning', () => {
    expect(priceIncrease([100000, 100000, 100000], 110000)).toEqual({ pct: 10, from: 100000, to: 110000 });
    expect(priceIncrease([100000, 100000], 103000)).toBeNull();
    expect(priceIncrease([100000], 200000)).toBeNull();
  });
});

import { checkBenefit } from '@/lib/benefits';
import { dailyFlex, fmtMinutes, payoutAmount } from '@/lib/flex';
describe('Lön del 2', () => {
  it('friskvårdsbidrag inom taket', () => {
    expect(checkBenefit('wellness', 300000, 200000)).toMatchObject({ ok: true, left: 0 });
    expect(checkBenefit('wellness', 300000, 250000)).toMatchObject({ ok: false, left: 200000 });
    expect(checkBenefit('christmas', 0, 60000).message).toContain('hela värdet skattepliktigt');
  });
  it('flex: planerat mot stämplat', () => {
    const shifts = [{ start: '2026-11-16T07:00:00Z', end: '2026-11-16T15:00:00Z' }, { start: '2026-11-17T07:00:00Z', end: '2026-11-17T15:00:00Z' }];
    const logs = [{ start: '2026-11-16T07:00:00Z', end: '2026-11-16T16:30:00Z' }, { start: '2026-11-17T07:30:00Z', end: '2026-11-17T15:00:00Z' }];
    const d = dailyFlex(shifts, logs, '2026-11-17');
    expect(d.map((x) => x.diff)).toEqual([90, -30]);
    expect(fmtMinutes(60)).toBe('+1:00'); expect(fmtMinutes(-90)).toBe('−1:30');
    expect(payoutAmount(165 * 60, 3300000)).toBe(3300000);
  });
});
