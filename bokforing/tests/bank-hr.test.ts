import { describe, it, expect, vi } from 'vitest';
import { generateKeyPairSync, verify } from 'node:crypto';
import { decimalToOre, fromEnableBanking, parseBankCsv, parseCamt053 } from '@/lib/bank/parse';
import { suggestMatches } from '@/lib/bank/match';
import { sanitizeHtml } from '@/lib/sanitize';
import { employmentContract, CHECKLISTS } from '@/modules/hr/templates';

vi.mock('server-only', () => ({}));

const CAMT = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
<Acct><Id><IBAN>SE4550000000058398257466</IBAN></Id></Acct>
<Ntry><Amt Ccy="SEK">11875.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-05-30</Dt></BookgDt>
<AcctSvcrRef>REF-1</AcctSvcrRef><NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Kund AB</Nm></Dbtr></RltdPties>
<RmtInf><Strd><CdtrRefInf><Ref>100164</Ref></CdtrRefInf></Strd></RmtInf></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="SEK">10000.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-05-29</Dt></BookgDt>
<NtryDtls><TxDtls><RltdPties><Cdtr><Nm>Hyresvärden &amp; Co</Nm></Cdtr></RltdPties><RmtInf><Ustrd>Hyra juni</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="SEK">5.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>PDNG</Sts><BookgDt><Dt>2026-05-31</Dt></BookgDt></Ntry>
</Stmt></BkToCstmrStmt></Document>`;

describe('bankfiler', () => {
  it('decimal till öre utan flyttalsfel', () => {
    expect(decimalToOre('0.29')).toBe(29);
    expect(decimalToOre('-1234.5')).toBe(-123450);
    expect(decimalToOre('100')).toBe(10000);
  });
  it('camt.053', () => {
    const r = parseCamt053(CAMT);
    expect(r.iban).toBe('SE4550000000058398257466');
    expect(r.transactions).toHaveLength(2); // PDNG hoppas över
    expect(r.transactions[0]).toMatchObject({ externalId: 'camt:REF-1', amount: 1187500, reference: '100164', counterparty: 'Kund AB', bookingDate: '2026-05-30' });
    expect(r.transactions[1]).toMatchObject({ amount: -1000000, counterparty: 'Hyresvärden & Co', description: 'Hyra juni' });
    expect(r.transactions[1].externalId).toMatch(/^h:/);
    // samma fil två gånger ger samma id (dubblettskydd)
    expect(parseCamt053(CAMT).transactions[1].externalId).toBe(r.transactions[1].externalId);
  });
  it('CSV från SEB, Swedbank och Nordea', () => {
    const seb = 'Bokföringsdatum;Valutadatum;Verifikationsnummer;Text/mottagare;Belopp;Saldo\n2026-05-30;2026-05-30;5484381424;KUND AB;11 875,00;50 000,00\n2026-05-29;2026-05-29;5484381425;HYRESVÄRDEN;-10 000,00;38 125,00';
    const s = parseBankCsv(seb);
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ bookingDate: '2026-05-30', amount: 1187500, description: 'KUND AB' });
    const swed = '* Transaktionsrapport Period 2026-05-01 – 2026-05-31\nRadnummer,Clearingnummer,Kontonummer,Produkt,Valuta,Bokföringsdag,Transaktionsdag,Valutadag,Referens,Beskrivning,Belopp,Bokfört saldo\n1,8327-9,123,Företagskonto,SEK,2026-05-30,2026-05-30,2026-05-30,100164,"KUND AB",11875.00,50000.00';
    const w = parseBankCsv(swed);
    expect(w[0]).toMatchObject({ amount: 1187500, reference: '100164', description: 'KUND AB', currency: 'SEK' });
    const nordea = 'Bokföringsdag;Belopp;Avsändare;Mottagare;Namn;Rubrik;Meddelande;Saldo;Valuta\n2026/05/29;-10000,00;;5551234;;Hyresvärden;12345678;38125,00;SEK';
    expect(parseBankCsv(nordea)[0]).toMatchObject({ bookingDate: '2026-05-29', amount: -1000000, description: 'Hyresvärden', reference: '12345678' });
    expect(() => parseBankCsv('a;b\n1;2')).toThrow();
  });
  it('Enable Banking-transaktioner', () => {
    const t = fromEnableBanking([
      { entry_reference: 'E1', transaction_amount: { amount: '11875.00', currency: 'SEK' }, credit_debit_indicator: 'CRDT', status: 'BOOK', booking_date: '2026-05-30', debtor: { name: 'Kund AB' }, remittance_information: ['OCR 100164'] },
      { transaction_amount: { amount: '120.50', currency: 'SEK' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: '2026-05-31', creditor: { name: 'Banken' } },
      { transaction_amount: { amount: '1.00', currency: 'SEK' }, credit_debit_indicator: 'DBIT', status: 'PDNG', booking_date: '2026-06-01' },
    ]);
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ externalId: 'eb:E1', amount: 1187500, counterparty: 'Kund AB', description: 'OCR 100164' });
    expect(t[1]).toMatchObject({ amount: -12050, counterparty: 'Banken' });
  });
});

describe('matchning', () => {
  const c = {
    invoices: [{ id: 1, number: 1001, ocr: '100164', total: 1187500, customer: 'Kund AB' }, { id: 2, number: 1002, ocr: '100263', total: 1187500, customer: 'Annan AB' }],
    supplierInvoices: [{ id: 7, invoiceNumber: 'H-1', paymentReference: '12345678', total: 1000000, supplier: 'Hyresvärden AB', status: 'approved' }],
    voucherLines: [{ voucherId: 9, label: 'A3', date: '2026-05-28', amount: -40000, description: 'Kontorsmaterial' }],
  };
  it('OCR + belopp ger 100 % och rätt faktura först', () => {
    const s = suggestMatches({ amount: 1187500, bookingDate: '2026-05-30', description: 'Kund AB', reference: '100164', counterparty: '' }, c);
    expect(s[0]).toMatchObject({ type: 'invoice', id: 1, score: 100 });
    expect(s[1].score).toBeLessThan(100);
  });
  it('leverantörsbetalning och redan bokförd verifikation', () => {
    expect(suggestMatches({ amount: -1000000, bookingDate: '2026-05-29', description: 'Hyra', reference: '12345678', counterparty: '' }, c)[0]).toMatchObject({ type: 'supplier_invoice', score: 100 });
    expect(suggestMatches({ amount: -40000, bookingDate: '2026-05-30', description: 'Clas Ohlson', reference: '', counterparty: '' }, c)[0]).toMatchObject({ type: 'voucher', id: 9 });
    expect(suggestMatches({ amount: -1, bookingDate: '2026-05-30', description: '', reference: '', counterparty: '' }, c)).toHaveLength(0);
  });
});

describe('Enable Banking JWT', () => {
  it('RS256 med kid, korrekt base64url och verifierbar signatur', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.ENABLEBANKING_APP_ID = 'app-123';
    process.env.ENABLEBANKING_PRIVATE_KEY = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }) as string).toString('base64');
    const { makeJwt } = await import('@/lib/bank/enablebanking');
    const jwt = makeJwt(1_767_225_600);
    const [h, p, sig] = jwt.split('.');
    expect(jwt).not.toMatch(/[=+/]/);
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ typ: 'JWT', alg: 'RS256', kid: 'app-123' });
    expect(JSON.parse(Buffer.from(p, 'base64url').toString())).toEqual({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: 1_767_225_600, exp: 1_767_229_200 });
    expect(verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(sig, 'base64url'))).toBe(true);
  });
});

describe('dokument', () => {
  it('sanering tar bort skript och attribut', () => {
    const dirty = '<h1 onclick="x()">Avtal</h1><script>alert(1)</script><p style="x">Text <a href="javascript:x">länk</a><img src=x onerror=alert(1)></p><iframe src="//evil"></iframe><td colspan="2">x</td><!-- c -->';
    const clean = sanitizeHtml(dirty);
    expect(clean).toBe('<h1>Avtal</h1><p>Text länk</p><td colspan="2">x</td>');
  });
  it('anställningsavtal escapar indata och innehåller LAS-uppgifter', () => {
    const html = employmentContract({
      employer: { name: 'Test <AB>', orgnr: '556026-9986', address: 'Storgatan 1' }, employee: { name: 'Anna', personal_number: '198112189876', address: '' },
      title: 'Utvecklare', department: '', start: '2026-08-01', employmentType: 'provanstallning', salary: 4000000, hours: '40 h', workplace: '',
      vacationDays: 25, noticeText: 'Enligt LAS', collectiveAgreement: '', pension: 'ITP', other: '',
    });
    expect(html).toContain('Test &lt;AB&gt;');
    for (const s of ['Parter', 'Befattning', 'Tillträde', 'Arbetsplats', 'Lön', 'Arbetstid', 'Semester', 'Uppsägning', 'Kollektivavtal', '40\u00a0000,00 kr', '19811218-9876']) expect(html).toContain(s);
    expect(sanitizeHtml(html)).toBe(html.replace(/<(h1|h3|p|b|br)>/g, '<$1>'));
  });
  it('checklistor har en automatisk signeringsuppgift per process', () => {
    for (const k of ['onboarding', 'move', 'offboarding'] as const) expect(CHECKLISTS[k].filter((t) => t.autoKey === 'document_signed')).toHaveLength(1);
  });
});
