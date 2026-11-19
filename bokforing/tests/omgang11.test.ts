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
