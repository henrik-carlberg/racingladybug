import { describe, expect, it } from 'vitest';
import { canView, hasPermission, parsePermissions } from '@/lib/permissions';
import { attestError, requiredApprovals } from '@/lib/attest';
import { changes } from '@/lib/changes';

describe('behörigheter', () => {
  it('ägaren har allt, begränsad konsult bara det valda', () => {
    expect(hasPermission('owner', ['invoicing'], 'payroll')).toBe(true);
    expect(hasPermission('accountant', null, 'payroll')).toBe(true);
    expect(hasPermission('accountant', ['invoicing'], 'payroll')).toBe(false);
    expect(hasPermission('accountant', ['invoicing'], 'invoicing')).toBe(true);
    expect(hasPermission('auditor', null, 'invoicing')).toBe(false);
    expect(canView('auditor', null, 'payroll')).toBe(true);
    expect(hasPermission('employee', null, 'payroll')).toBe(false);
  });
  it('tolkar formulärval', () => {
    expect(parsePermissions(['ledger', 'x', 'payroll'])).toEqual(['payroll', 'ledger']);
    expect(parsePermissions(null)).toBeNull();
  });
});

describe('attest i flera steg', () => {
  const rules = { threshold: 5_000_000, notRegistrant: true };
  it('två attester från beloppsgränsen', () => {
    expect(requiredApprovals(4_999_999, rules)).toBe(1);
    expect(requiredApprovals(5_000_000, rules)).toBe(2);
    expect(requiredApprovals(9_000_000, { threshold: null, notRegistrant: false })).toBe(1);
  });
  it('samma person kan inte attestera två gånger eller sin egen registrering', () => {
    expect(attestError({ userId: 1, registeredBy: 2, approvedBy: [1], rules })).toContain('redan attesterat');
    expect(attestError({ userId: 2, registeredBy: 2, approvedBy: [], rules })).toContain('registrerat');
    expect(attestError({ userId: 3, registeredBy: 2, approvedBy: [1], rules })).toBeNull();
  });
});

describe('ändringshistorik', () => {
  it('visar bara ändrade fält', () => {
    expect(changes({ name: 'A', city: 'Malmö', email: '' }, { name: 'B', city: 'Malmö', email: null })).toEqual({ name: ['A', 'B'] });
  });
});

import { peppolXml, type PeppolInvoice } from '@/lib/peppol';
import { parseUbl, isUbl } from '@/lib/peppol-in';
import { parseCamt054 } from '@/lib/bank/parse';
describe('mottagen e-faktura', () => {
  const inv: PeppolInvoice = {
    number: 1042, issueDate: '2026-11-02', dueDate: '2026-12-02', deliveryDate: '', buyerReference: 'Ref 7', reverseCharge: false,
    lines: [{ description: 'Hyra december', quantity: 1, unit: 'st', unitPrice: 1000000, vatRate: 25, net: 1000000 }],
    totals: { net: 1000000, vat: 250000, rounding: 0, total: 1250000, vatByRate: { 25: { base: 1000000, vat: 250000 } } },
    seller: { name: 'Hyresvärden AB', orgnr: '556677-8899', vatNumber: 'SE556677889901', address: 'Storgatan 1', postalCode: '111 22', city: 'Stockholm', country: 'SE', fSkatt: true },
    buyer: { name: 'Kund AB', orgnr: '556026-9986', vatNumber: '', address: 'Gatan 2', postalCode: '411 01', city: 'Göteborg', country: 'SE', endpoint: '0007:5560269986' },
    payment: { ocr: '104251', bankgiro: '5050-1055', plusgiro: '', iban: '', terms: '30 dagar netto' },
  };
  it('läser vår egen Peppol-faktura tillbaka', () => {
    const x = peppolXml(inv);
    expect(isUbl(x)).toBe(true);
    const e = parseUbl(x);
    expect(e).toMatchObject({ documentType: 'invoice', invoiceNumber: '1042', invoiceDate: '2026-11-02', dueDate: '2026-12-02', paymentReference: '104251', total: 1250000, vat: 250000, currency: 'SEK' });
    expect(e.supplier).toMatchObject({ name: 'Hyresvärden AB', orgnr: '556677-8899', vatNumber: 'SE556677889901', bankgiro: '5050-1055' });
    expect(e.description).toBe('Hyra december');
  });
  it('avvisar annan XML', () => {
    expect(() => parseUbl('<foo/>')).toThrow();
  });
});

describe('camt.054', () => {
  const xml = `<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02"><BkToCstmrDbtCdtNtfctn><Ntfctn>
    <Ntry><Amt Ccy="SEK">12500.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-11-28</Dt></BookgDt>
      <NtryDtls><TxDtls><Refs><EndToEndId>LF12</EndToEndId></Refs><AmtDtls><InstdAmt><Amt Ccy="SEK">10000.00</Amt></InstdAmt></AmtDtls><RltdPties><Cdtr><Nm>Hyresvärden AB</Nm></Cdtr></RltdPties></TxDtls>
      <TxDtls><Refs><EndToEndId>LF13</EndToEndId></Refs><Amt Ccy="SEK">2500.00</Amt></TxDtls></NtryDtls></Ntry>
    <Ntry><Amt Ccy="SEK">300.00</Amt><Sts>RJCT</Sts><BookgDt><Dt>2026-11-28</Dt></BookgDt><NtryDtls><TxDtls><Refs><EndToEndId>LF14</EndToEndId></Refs><Amt Ccy="SEK">300.00</Amt></TxDtls></NtryDtls></Ntry>
  </Ntfctn></BkToCstmrDbtCdtNtfctn></Document>`;
  it('läser betalningar per transaktion', () => {
    const p = parseCamt054(xml);
    expect(p.map((x) => [x.endToEndId, x.amount, x.status])).toEqual([['LF12', 1000000, 'booked'], ['LF13', 250000, 'booked'], ['LF14', 30000, 'rejected']]);
    expect(p[0].date).toBe('2026-11-28');
    expect(p[0].creditor).toBe('Hyresvärden AB');
  });
});

import { kpis, payBins } from '@/lib/kpi';
describe('nyckeltal', () => {
  it('soliditet, kassalikviditet och marginaler', () => {
    const balance = new Map([[1220, 20000000], [1510, 30000000], [1930, 50000000], [2081, -5000000], [2091, -25000000], [2440, -40000000], [2150, -10000000]]);
    const result = new Map([[3001, -100000000], [4010, 40000000], [5010, 20000000], [7210, 30000000], [8310, -1000000]]);
    const k = Object.fromEntries(kpis({ balance, result, avgPayDays: 28 }).map((x) => [x.key, x]));
    expect(k.solidity.value).toBe(Math.round(((30000000 + 7940000) / 100000000) * 1000) / 10);
    expect(k.quick.value).toBe(200);
    expect(k.quick.status).toBe('good');
    expect(k.gross.value).toBe(60);
    expect(k.operating.value).toBe(10);
    expect(k.paydays.status).toBe('good');
  });
  it('betaltider i intervall', () => {
    expect(payBins([3, 10, 11, 30, 31, 90]).map((b) => b.count)).toEqual([2, 1, 1, 1, 0, 1]);
  });
});
