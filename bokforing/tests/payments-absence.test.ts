import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { peppolErrors, peppolXml, unitCode, type PeppolInvoice } from '@/lib/peppol';
import { formatSwish, luhnValid, pain001Xml, paymentError, swishQrData } from '@/lib/pain001';
import { hourlyRate, leaveItems, sickItems, vacationDaysTaken, vacationItems, workdays } from '@/lib/absence';

const wellFormed = (xml: string) => {
  const f = join(mkdtempSync(join(tmpdir(), 'x')), 'a.xml');
  writeFileSync(f, xml);
  try { execFileSync('xmllint', ['--noout', f], { stdio: 'pipe' }); return true; } catch (e) { const m = String((e as Error).message); if (m.includes('ENOENT')) return true; throw e; }
};

const base: PeppolInvoice = {
  number: 1001, issueDate: '2026-11-17', dueDate: '2026-12-17', buyerReference: 'Anna Ref', reverseCharge: false,
  lines: [{ description: 'Konsult & stöd', quantity: 10, unit: 'h', unitPrice: 100000, vatRate: 25, net: 1000000 }, { description: 'Bok', quantity: 1, unit: 'st', unitPrice: 20000, vatRate: 6, net: 20000 }],
  totals: { net: 1020000, vat: 251200, rounding: 0, total: 1271200, vatByRate: { 25: { base: 1000000, vat: 250000 }, 6: { base: 20000, vat: 1200 } } },
  seller: { name: 'Testbolaget AB', orgnr: '556026-9986', vatNumber: 'SE556026998601', address: 'Storgatan 1', postalCode: '111 22', city: 'Stockholm', country: 'SE', fSkatt: true },
  buyer: { name: 'Kommunen', orgnr: '212000-0142', address: 'Torget 1', postalCode: '411 01', city: 'Göteborg', country: 'SE', endpoint: '0007:2120000142' },
  payment: { ocr: '100125', bankgiro: '123-4567', terms: '30 dagar' },
};

describe('Peppol BIS 3', () => {
  it('faktura med obligatoriska element', () => {
    const x = peppolXml(base);
    expect(wellFormed(x)).toBe(true);
    expect(x).toContain('<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>');
    expect(x).toContain('<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>');
    expect(x).toContain('<cbc:EndpointID schemeID="0007">5560269986</cbc:EndpointID>');
    expect(x).toContain('<cbc:EndpointID schemeID="0007">2120000142</cbc:EndpointID>');
    expect(x).toContain('<cbc:BuyerReference>Anna Ref</cbc:BuyerReference>');
    expect(x).toContain('Godkänd för F-skatt');
    expect(x).toContain('<cbc:PaymentID>100125</cbc:PaymentID>');
    expect(x).toContain('<cbc:ID>1234567</cbc:ID><cac:FinancialInstitutionBranch><cbc:ID>9900</cbc:ID>');
    expect(x).toContain('<cbc:TaxAmount currencyID="SEK">2512.00</cbc:TaxAmount>');
    expect(x).toContain('<cbc:PayableAmount currencyID="SEK">12712.00</cbc:PayableAmount>');
    expect(x).toContain('<cbc:InvoicedQuantity unitCode="HUR">10</cbc:InvoicedQuantity>');
    expect(x).toContain('Konsult &amp; stöd');
    expect(peppolErrors(base)).toEqual([]);
  });
  it('kreditnota med positiva belopp och referens', () => {
    const c = { ...base, number: 1002, credit: { originalNumber: 1001 }, lines: base.lines.map((l) => ({ ...l, quantity: -l.quantity, net: -l.net })),
      totals: { ...base.totals, net: -1020000, vat: -251200, total: -1271200, vatByRate: { 25: { base: -1000000, vat: -250000 }, 6: { base: -20000, vat: -1200 } } } };
    const x = peppolXml(c);
    expect(wellFormed(x)).toBe(true);
    expect(x).toContain('<CreditNote');
    expect(x).toContain('<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>');
    expect(x).toContain('<cac:InvoiceDocumentReference><cbc:ID>1001</cbc:ID>');
    expect(x).toContain('<cbc:CreditedQuantity unitCode="HUR">10</cbc:CreditedQuantity>');
    expect(x).toContain('<cbc:PayableAmount currencyID="SEK">12712.00</cbc:PayableAmount>');
  });
  it('kontroller', () => {
    expect(peppolErrors({ ...base, buyerReference: '', buyer: { ...base.buyer, endpoint: undefined } })).toHaveLength(2);
    expect(unitCode('dag')).toBe('DAY');
    expect(unitCode('xyz')).toBe('C62');
  });
});

describe('Betalfil pain.001', () => {
  it('OCR med kontrollsiffra blir SCOR, annars fritext', () => {
    expect(luhnValid('100123')).toBe(true);
    expect(luhnValid('100125')).toBe(false);
    const x = pain001Xml({ messageId: 'BF1', created: '2026-11-17T10:00:00', debtor: { name: 'Testbolaget AB', orgnr: '556026-9986', iban: 'SE45 5000 0000 0583 9825 7466', bic: 'ESSESESS' }, payments: [
      { id: 'LF1', name: 'Leverantör AB', bankgiro: '5050-1055', reference: '100123', amount: 125000, date: '2026-11-20', invoiceNumber: 'A1' },
      { id: 'LF2', name: 'Plus AB', plusgiro: '4789900-3', reference: 'Faktura 77', amount: 50050, date: '2026-11-20', invoiceNumber: '77' },
      { id: 'LF3', name: 'Bank AB', bankAccount: '8327-9 123456789', reference: '', amount: 1000, date: '2026-11-25', invoiceNumber: 'B9' },
    ] });
    expect(wellFormed(x)).toBe(true);
    expect(x).toContain('<NbOfTxs>3</NbOfTxs><CtrlSum>1760.50</CtrlSum>');
    expect(x).toContain('<Id>50501055</Id><SchmeNm><Prtry>BGNR</Prtry></SchmeNm>');
    expect(x).toContain('<Cd>SCOR</Cd></CdOrPrtry></Tp><Ref>100123</Ref>');
    expect(x).toContain('<Ustrd>Faktura 77</Ustrd>');
    expect(x).toContain('<MmbId>9960</MmbId>');
    expect(x).toContain('<MmbId>83279</MmbId>');
    expect((x.match(/<PmtInf>/g) || []).length).toBe(2);
    expect(x).toContain('<IBAN>SE4550000000058398257466</IBAN>');
  });
  it('validering', () => {
    expect(paymentError({ id: '1', name: 'X', reference: '', amount: 100, date: '2026-11-20', invoiceNumber: '1' })).toMatch(/saknar/);
    expect(paymentError({ id: '1', name: 'X', bankgiro: '12', reference: '', amount: 100, date: '2026-11-20', invoiceNumber: '1' })).toMatch(/bankgiro/);
  });
  it('Swish-QR', () => {
    expect(swishQrData('123 456 78 90', 125000, '100125')).toBe('C1234567890;1250;100125;0');
    expect(swishQrData('1231181189', 12550, 'a;b')).toBe('C1231181189;125.50;a b;0');
    expect(formatSwish('1234567890')).toBe('123 456 78 90');
    expect(formatSwish('0701234567')).toBe('070-123 45 67');
  });
});

describe('Frånvaro och lön', () => {
  it('arbetsdagar utan helgdagar', () => {
    expect(workdays('2026-12-21', '2026-12-27')).toEqual(['2026-12-21', '2026-12-22', '2026-12-23']);
  });
  it('sjuklön 80 % och karensavdrag (35 000 kr, 40 h/vecka, mån–ons)', () => {
    expect(Math.round(hourlyRate(3500000, 40))).toBe(20192);
    const items = sickItems({ from: '2026-11-09', to: '2026-11-11', extent: 100, monthly: 3500000, hoursPerWeek: 40 });
    expect(items).toEqual([
      { type: 'salary', description: 'Sjukavdrag 3 dagar 2026-11-09–2026-11-11', amount: -484615 },
      { type: 'salary', description: 'Sjuklön 80 % 3 dagar', amount: 387692 },
      { type: 'salary', description: 'Karensavdrag', amount: -129231 },
    ]);
    expect(sickItems({ from: '2026-11-09', to: '2026-11-11', extent: 100, monthly: 3500000, hoursPerWeek: 40, noKarens: true }).some((i) => i.description === 'Karensavdrag')).toBe(false);
  });
  it('ingen sjuklön från dag 15', () => {
    const items = sickItems({ from: '2026-11-02', to: '2026-11-27', extent: 100, monthly: 3500000, hoursPerWeek: 40 });
    expect(items[0].description).toContain('20 dagar');
    expect(items[1].description).toBe('Sjuklön 80 % 10 dagar'); // 2–15 nov: 10 arbetsdagar
  });
  it('semestertillägg och löneavdrag', () => {
    expect(vacationItems({ from: '2026-07-06', to: '2026-07-10', monthly: 3500000 })[0].amount).toBe(75250); // 0,43 % × 35 000 × 5
    expect(leaveItems({ kind: 'vab', from: '2026-11-17', to: '2026-11-17', extent: 50, monthly: 3500000, hoursPerWeek: 40 })[0].amount).toBe(-80769);
    expect(vacationDaysTaken([{ kind: 'vacation', from: '2026-12-28', to: '2027-01-08', extent: 100 }], 2026)).toBe(3);
  });
});
