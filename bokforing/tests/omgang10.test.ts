import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { canReceive, eventScope, parseScopes, pkceOk, validRedirectUri } from '@/lib/oauth';

describe('OAuth', () => {
  it('återkomstadresser', () => {
    expect(validRedirectUri('https://app.example.com/cb')).toBe(true);
    expect(validRedirectUri('http://localhost:3000/cb')).toBe(true);
    expect(validRedirectUri('http://example.com/cb')).toBe(false);
    expect(validRedirectUri('https://a.example/cb#x')).toBe(false);
    expect(validRedirectUri('javascript:alert(1)')).toBe(false);
    expect(validRedirectUri('https://user:pw@a.example/')).toBe(false);
  });
  it('PKCE S256', () => {
    const v = 'a'.repeat(50), c = createHash('sha256').update(v).digest('base64url');
    expect(pkceOk(v, c)).toBe(true);
    expect(pkceOk('b'.repeat(50), c)).toBe(false);
    expect(pkceOk('kort', c)).toBe(false);
  });
  it('behörigheter', () => {
    const k = new Set(['sales:read', 'sales:write']);
    expect(parseScopes('sales:read sales:read,sales:write', k)).toEqual(['sales:read', 'sales:write']);
    expect(() => parseScopes('payroll:read', k)).toThrow(/Okända/);
    expect(() => parseScopes(' ', k)).toThrow();
  });
  it('händelser kräver läsbehörighet för området', () => {
    expect(eventScope('invoice.paid')).toBe('sales:read');
    expect(eventScope('payroll_run.booked')).toBe('payroll:read');
    expect(eventScope('crm.deal.won')).toBe('crm:read');
    expect(canReceive('invoice.paid', ['sales:read'])).toBe(true);
    expect(canReceive('employee.updated', ['sales:read', 'sales:write'])).toBe(false);
    expect(canReceive('invoice.paid', ['sales:write'])).toBe(true);
  });
});

import { allowanceDays, matchReceipts } from '@/lib/cards';
describe('Företagskort och resor', () => {
  it('kortköp matchas mot kvitton: belopp, datum, butik', () => {
    const tx = [{ id: 1, date: '2026-11-10', amount: -12500, text: 'KORTKÖP ICA MAXI' }, { id: 2, date: '2026-11-11', amount: -12500, text: 'KORTKÖP CIRCLE K' }, { id: 3, date: '2026-11-12', amount: -999, text: 'X' }];
    const rc = [{ id: 10, date: '2026-11-11', amount: 12500, text: 'Drivmedel Circle K' }, { id: 11, date: '2026-11-10', amount: 12500, text: 'Fika ICA' }, { id: 12, date: '2026-11-20', amount: 999, text: 'X' }];
    expect(matchReceipts(tx, rc)).toEqual([{ txId: 1, voucherId: 11 }, { txId: 2, voucherId: 10 }]);
  });
  it('traktamente efter tider', () => {
    expect(allowanceDays('2026-11-10T07:00', '2026-11-12T20:00')).toEqual({ full: 3, half: 0, nights: 2 });
    expect(allowanceDays('2026-11-10T13:00', '2026-11-11T15:00')).toEqual({ full: 0, half: 2, nights: 1 });
    expect(allowanceDays('2026-11-10T08:00', '2026-11-10T22:00')).toEqual({ full: 0, half: 0, nights: 0 });
    expect(() => allowanceDays('2026-11-10T08:00', '2026-11-09T08:00')).toThrow();
  });
});

import { maxDepreciation, parseEskd, prelimProposal, taxForecast, vatReconcile, yearEndProposals } from '@/lib/tax-planning';
describe('Skatt och bokslut', () => {
  it('skattekontoprognos visar när saldot blir negativt', () => {
    const f = taxForecast(1000000, [{ date: '2026-12-12', text: 'Moms', amount: -1500000 }, { date: '2026-12-12', text: 'F-skatt', amount: -200000 }, { date: '2027-01-17', text: 'F-skatt', amount: -200000 }]);
    expect(f.rows.map((r) => r.balance)).toEqual([-500000, -700000, -900000]);
    expect(f.shortfall).toEqual({ date: '2026-12-12', amount: 900000 });
  });
  it('preliminärskatt: höj när prognosen är högre', () => {
    const p = prelimProposal({ type: 'AB', ytdProfit: 50000000, nonDeductible: 0, monthsElapsed: 10, currentMonthly: 500000 });
    expect(p.profit).toBe(60000000); expect(p.tax).toBe(12360000); expect(p.monthly).toBe(1030000); expect(p.change).toBe(true);
    expect(p.advice).toContain('Höj');
  });
  it('30-regeln och 20-regeln', () => {
    expect(maxDepreciation({ bookStart: 10000000, overStart: 0, acquisitions: 0, disposals: 0, bookedDepreciation: 0 }).max).toBe(3000000);
    const m = maxDepreciation({ bookStart: 2000000, overStart: 0, acquisitions: 0, disposals: 0, bookedDepreciation: 0, byYear: [{ yearsHeld: 4, cost: 5000000 }] });
    expect(m.rule).toBe('20-regeln'); expect(m.max).toBe(1000000);
  });
  it('bokslutsförslag i rätt ordning med skatteeffekt', () => {
    const r = yearEndProposals({ type: 'AB', year: 2026, resultBeforeAppropriations: 100000000, nonDeductible: 0,
      inventories: { bookStart: 10000000, overStart: 0, acquisitions: 0, disposals: 0, bookedDepreciation: 2000000 },
      fonds: [{ account: 2120, year: 2020, amount: 5000000 }], group: [{ name: 'Dotter AB', result: -20000000, ownership: 100 }] });
    expect(r.proposals.map((p) => [p.kind, p.amount])).toEqual([['aterforing', 5000000], ['koncernbidrag', 20000000], ['overavskrivning', 1000000], ['periodiseringsfond', 21000000]]);
    expect(r.proposals[3].lines).toEqual([{ account: 2126, amount: -21000000 }, { account: 8811, amount: 21000000 }]);
    expect(r.taxAfter).toBe(Math.round(63000000 * 0.206));
  });
  it('momsavstämning ruta för ruta och mot inlämnad deklaration', () => {
    const boxes = new Map([['05', 10000000], ['10', 2500000], ['21', 400000], ['30', 100000], ['48', 50000], ['49', 2550000]]);
    const c = vatReconcile(boxes, parseEskd('<MomsUtgHog>25000</MomsUtgHog><ForsMomsEjAnnan>90000</ForsMomsEjAnnan><MomsIngAvdr>500</MomsIngAvdr><MomsInkopUtgHog>1000</MomsInkopUtgHog><InkopTjanstAnnatEg>4000</InkopTjanstAnnatEg>'));
    expect(c.find((x) => x.key === 'utgaende')!.ok).toBe(true);
    expect(c.find((x) => x.key === 'avdrag')!.ok).toBe(false);
    expect(c.find((x) => x.key === 'inlamnad')!.detail.replace(/\s/g, ' ')).toContain('ruta 05 90 000 kr → 100 000 kr');
  });
});

import { installmentPlan, mapSwishStatus, mobileE164, planStatus, smsReminder, swishMessage } from '@/lib/paid-faster';
describe('Betalt snabbare', () => {
  it('delbetalningsplan i hela kronor med månadsvisa förfallodagar', () => {
    expect(installmentPlan(1000050, 3, '2026-01-31')).toEqual([{ n: 1, due: '2026-01-31', amount: 333300 }, { n: 2, due: '2026-02-28', amount: 333300 }, { n: 3, due: '2026-03-31', amount: 333450 }]);
    expect(() => installmentPlan(1000, 1, '2026-01-01')).toThrow();
  });
  it('planstatus: förfallet och nästa del', () => {
    const plan = installmentPlan(300000, 3, '2026-01-10');
    expect(planStatus(plan, 0, '2026-02-15')).toEqual({ overdue: 200000, next: { n: 1, due: '2026-01-10', amount: 100000, left: 100000 }, paidParts: 0 });
    expect(planStatus(plan, 150000, '2026-02-15')).toMatchObject({ overdue: 50000, next: { n: 2, left: 50000 }, paidParts: 1 });
  });
  it('telefonnummer, Swish och SMS', () => {
    expect(mobileE164('070-123 45 67')).toBe('+46701234567');
    expect(mobileE164('08-123 456')).toBeNull();
    expect(swishMessage('Faktura 1001 <script>')).toBe('Faktura 1001 script');
    expect(mapSwishStatus('PAID')).toBe('paid');
    expect(smsReminder({ company: 'AB', number: 7, amount: '100,00', due: '2026-01-01', link: 'https://x/f/t', level: 1 })).toContain('Betala här: https://x/f/t');
  });
});

import { deflateSync } from 'node:zlib';
import { documentText, normalizeTag, parseQuery, pdfText, retentionUntil } from '@/lib/doc-text';
describe('Sök och arkiv', () => {
  const pdf = (content: string, flate: boolean) => {
    const body = flate ? deflateSync(Buffer.from(content, 'latin1')) : Buffer.from(content, 'latin1');
    return Buffer.concat([Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${body.length}${flate ? ' /Filter /FlateDecode' : ''} >>\nstream\n`, 'latin1'), body, Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1')]);
  };
  it('text ur PDF (komprimerad och okomprimerad, hex och TJ)', () => {
    const c = 'BT /F1 12 Tf 72 700 Td (Faktura 4711 fr\\345n Kontorsbolaget) Tj 0 -14 Td [(Att ) -20 (betala)] TJ <FEFF0020003100320033> Tj ET';
    expect(pdfText(pdf(c, true))).toBe('Faktura 4711 från Kontorsbolaget\nAtt betala 123');
    expect(pdfText(pdf('BT (Hyra mars) Tj ET', false))).toBe('Hyra mars');
  });
  it('text- och XML-filer, bilder ger null', () => {
    expect(documentText('application/xml', 'f.xml', Buffer.from('<a><b>Leverantör AB</b></a>'))).toBe('Leverantör AB');
    expect(documentText('image/png', 'k.png', Buffer.from([1, 2]))).toBeNull();
  });
  it('sökfråga, gallring och taggar', () => {
    expect(parseQuery('1 250,50')).toMatchObject({ amount: 125050 });
    expect(parseQuery('1009')).toMatchObject({ number: '1009', amount: 100900 });
    expect(parseQuery('hyra')).toMatchObject({ amount: null, number: null });
    expect(retentionUntil('2026-12-31')).toBe('2033-12-31');
    expect(retentionUntil('2027-06-30')).toBe('2034-12-31');
    expect(normalizeTag(' Avtal 2026! ')).toBe('avtal-2026');
    expect(normalizeTag('x')).toBeNull();
  });
});
