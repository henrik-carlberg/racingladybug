import { describe, expect, it } from 'vitest';
import { angleOf, icsCalendar, itemStatus, occurrences, sector } from '@/lib/wheel';

describe('Årshjul: återkommande datum', () => {
  it('varje månad, dag 31 blir sista dagen', () => {
    expect(occurrences({ recurrence: 'monthly', startDate: '2026-01-01', day: 31 }, '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
  it('varje kvartal från andra månaden i kvartalet', () => {
    expect(occurrences({ recurrence: 'quarterly', startDate: '2026-01-01', day: 5, month: 2 }, '2026-01-01', '2026-12-31')).toEqual(['2026-02-05', '2026-05-05', '2026-08-05', '2026-11-05']);
  });
  it('varje år, start- och slutdatum respekteras', () => {
    expect(occurrences({ recurrence: 'yearly', startDate: '2026-06-01', day: 15, month: 3 }, '2026-01-01', '2028-12-31')).toEqual(['2027-03-15', '2028-03-15']);
    expect(occurrences({ recurrence: 'yearly', startDate: '2026-01-01', endDate: '2027-12-31', day: 15, month: 3 }, '2026-01-01', '2028-12-31')).toEqual(['2026-03-15', '2027-03-15']);
  });
  it('varje vecka på en veckodag och en gång', () => {
    expect(occurrences({ recurrence: 'weekly', startDate: '2026-11-01', day: 1 }, '2026-11-01', '2026-11-30')).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']);
    expect(occurrences({ recurrence: 'once', startDate: '2026-11-19' }, '2026-11-01', '2026-11-30')).toEqual(['2026-11-19']);
    expect(occurrences({ recurrence: 'once', startDate: '2026-12-19' }, '2026-11-01', '2026-11-30')).toEqual([]);
  });
});
describe('Årshjul: geometri, status och kalender', () => {
  it('vinklar', () => {
    expect(angleOf('2026-01-01', 'year')).toBeLessThan(0.02);
    expect(angleOf('2026-07-02', 'year')).toBeCloseTo(Math.PI, 1);
    expect(angleOf('2026-11-15', 'month')).toBeCloseTo((14.5 / 30) * 2 * Math.PI, 5);
    expect(sector(100, 100, 50, 80, 0, Math.PI / 2)).toMatch(/^M100\.00 20\.00A80 80 0 0 1 180\.00 100\.00L150\.00 100\.00A50 50 0 0 0 100\.00 50\.00Z$/);
  });
  it('status', () => {
    const i = { key: 'k', date: '2026-11-20', module: 'lon' as const, title: 'x', done: false, own: true };
    expect(itemStatus(i, '2026-11-19')).toBe('soon'); expect(itemStatus(i, '2026-11-21')).toBe('overdue'); expect(itemStatus({ ...i, done: true }, '2026-11-21')).toBe('done');
    expect(itemStatus(i, '2026-10-01')).toBe('upcoming');
  });
  it('iCal', () => {
    const c = icsCalendar('Årshjul; Test', [{ key: 'egen:1:2026-11-20', date: '2026-11-20', title: 'Lönesamtal, Anna', done: false }], new Date('2026-11-19T10:00:00Z'));
    expect(c).toContain('BEGIN:VCALENDAR\r\n'); expect(c).toContain('DTSTART;VALUE=DATE:20261120'); expect(c).toContain('DTEND;VALUE=DATE:20261121');
    expect(c).toContain('SUMMARY:Lönesamtal\\, Anna'); expect(c).toContain('X-WR-CALNAME:Årshjul\\; Test'); expect(c).toContain('UID:egen:1:2026-11-20@bokforing');
  });
});

import { decide, fullPnr, parseRepresentation, soleTraderPnrs } from '@/lib/signatory';
describe('Firmateckning', () => {
  const r = parseRepresentation({ namn: 'Testbolaget AB', firmateckning: { antalIForening: 2, text: 'Två ledamöter i förening' }, foretradare: [
    { personnummer: '19800101-0019', namn: 'Ägare Testsson', roller: ['Styrelseledamot', 'Verkställande direktör'] },
    { personnummer: '7505050000', namn: 'Bo Delägare', roller: ['Styrelseledamot'] },
    { personnummer: '196001010000', namn: 'Revi Sor', roller: ['Revisor'] },
    { personnummer: 'fel', namn: 'Ingen' },
  ] });
  it('läser företrädare', () => {
    expect(r.reps.map((x) => x.pnr)).toEqual(['198001010019', '197505050000', '196001010000']);
    expect(r.jointly).toBe(2);
  });
  it('två ledamöter i förening krävs; revisorn räknas inte', () => {
    expect(decide(r, ['198001010019'])).toMatchObject({ verified: false, missing: 1 });
    expect(decide(r, ['198001010019', '196001010000'])).toMatchObject({ verified: false, missing: 1 });
    expect(decide(r, ['198001010019', '197505050000'])).toMatchObject({ verified: true, missing: 0 });
    expect(decide(r, ['199912310000']).verified).toBe(false);
  });
  it('ensam firmatecknare räcker', () => {
    const e = parseRepresentation({ foretradare: [{ personnummer: '198001010019', namn: 'A', roller: ['Styrelseledamot'], ensamFirmatecknare: true }] });
    expect(decide(e, ['198001010019']).verified).toBe(true);
  });
  it('personnummer och enskild firma', () => {
    expect(fullPnr('0501011234', new Date('2026-01-01'))).toBe('200501011234');
    expect(fullPnr('8112189876', new Date('2026-01-01'))).toBe('198112189876');
    expect(soleTraderPnrs('811218-9876')).toEqual(['19811218987' + '6', '20811218' + '9876']);
  });
});

import { creditorAccount, mapPaymentStatus, paymentRequest } from '@/lib/bankpay';
describe('Betalning via banken', () => {
  it('mottagarkonto', () => {
    expect(creditorAccount({ bankgiro: '5050-1055' })).toEqual({ kind: 'bankgiro', id: '50501055' });
    expect(creditorAccount({ plusgiro: '4789-1' })).toEqual({ kind: 'plusgiro', id: '47891' });
    expect(creditorAccount({ iban: 'se45 5000 0000 0583 9825 7466' })).toEqual({ kind: 'iban', id: 'SE4550000000058398257466' });
    expect(creditorAccount({ clearing: '8327-9', account: '123 456 789-0' })).toEqual({ kind: 'bban', id: '83279' + '1234567890' });
    expect(creditorAccount({})).toBeNull();
  });
  it('betalningsbegäran', () => {
    const r = paymentRequest({ debtorIban: 'SE45 5000 0000 0583 9825 7466', date: '2026-11-20', items: [
      { name: 'Hyresvärden AB', account: { kind: 'bankgiro', id: '50501055' }, amount: 1250050, reference: '123456789', endToEnd: 'si-7' },
      { name: 'Lärbolaget AB', account: { kind: 'iban', id: 'SE4550000000058398257466' }, amount: 99, reference: 'F 12', endToEnd: 'si-8' }] });
    expect(r.payment_type).toBe('BULK_DOMESTIC');
    expect(r.payment_request.debtor_account.iban).toBe('SE4550000000058398257466');
    expect(r.payment_request.credit_transfer_transaction[0]).toMatchObject({ instructed_amount: { amount: '12500.50', currency: 'SEK' }, beneficiary: { creditor_account: { scheme_name: 'BGNR', identification: '50501055' } }, remittance_information: ['123456789'] });
    expect(r.payment_request.credit_transfer_transaction[1].instructed_amount.amount).toBe('0.99');
  });
  it('status', () => {
    expect(mapPaymentStatus('ACSC')).toBe('executed'); expect(mapPaymentStatus('ACTC')).toBe('accepted'); expect(mapPaymentStatus('RJCT')).toBe('rejected'); expect(mapPaymentStatus('RCVD')).toBe('authorization');
  });
});

import { evalFormula, evaluate, kpis, parseRanges, validateDef } from '@/lib/report-builder';
describe('Rapportbyggare', () => {
  it('kontointervall', () => {
    expect(parseRanges('3000-3999, -4000-4999, 8310')).toEqual([{ from: 3000, to: 3999, sign: 1 }, { from: 4000, to: 4999, sign: -1 }, { from: 8310, to: 8310, sign: 1 }]);
    expect(() => parseRanges('abc')).toThrow(/Ogiltigt/); expect(() => parseRanges('3999-3000')).toThrow(); expect(() => parseRanges('')).toThrow();
  });
  it('formler utan eval', () => {
    expect(evalFormula('r1 - r2 * 2', { r1: 10, r2: 3 })).toBe(4);
    expect(evalFormula('(r1 - r2) / r1 * 100', { r1: 200, r2: 50 })).toBe(75);
    expect(evalFormula('r1 / r2', { r1: 1, r2: 0 })).toBeNull();
    expect(evalFormula('-r1', { r1: 5 })).toBe(-5);
    expect(() => evalFormula('r9', { r1: 1 })).toThrow(/Okänd rad/);
    expect(() => evalFormula('process.exit()', {})).toThrow();
    expect(() => evalFormula('r1 +', { r1: 1 })).toThrow();
  });
  it('rapport med perioder, formel, balansrad och budget', () => {
    const m = (o: Record<number, number>) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));
    const def = { columns: 'year' as const, compare: false, budget: true, rows: [
      { key: 'r1', label: 'Intäkter', type: 'accounts' as const, value: '3000-3999' },
      { key: 'r2', label: 'Kostnader', type: 'accounts' as const, value: '4000-7999' },
      { key: 'r3', label: 'Resultat', type: 'formula' as const, value: 'r1 - r2', bold: true },
      { key: 'r4', label: 'Marginal %', type: 'formula' as const, value: 'r3 / r1 * 100' },
      { key: 'r5', label: 'Kassa', type: 'accounts' as const, value: '1900-1999' },
    ] };
    expect(validateDef(def)).toEqual([]);
    const out = evaluate(def, [{ label: '2026', result: m({ 3001: -100000, 5010: 30000, 7010: 20000 }), balance: m({ 1930: 55000, 2440: -5000 }), budget: m({ 3001: 120000, 5010: 30000 }) }]);
    expect(out.map((r) => r.values[0])).toEqual([100000, 50000, 50000, 50, 55000]);
    expect(out.map((r) => r.budget[0])).toEqual([120000, 30000, 90000, 75, null]);
    expect(validateDef({ ...def, rows: [{ key: 'r1', label: 'X', type: 'formula', value: 'r2 + 1' }] })[0]).toContain('Okänd rad');
  });
  it('nyckeltal', () => {
    const m = (o: Record<number, number>) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));
    const k = kpis(m({ 3001: -1000000, 4010: 400000, 5010: 200000, 7010: 200000, 8410: 10000 }), m({ 1510: 125000, 1930: 375000, 1220: 500000, 2081: -50000, 2099: -500000, 2440: -250000, 2710: -200000 }), 365);
    expect(k).toMatchObject({ revenue: 1000000, grossProfit: 600000, grossMargin: 60, operatingResult: 200000, operatingMargin: 20, result: 190000, cash: 375000, currentLiabilities: 450000 });
    expect(k.equityRatio).toBe(55); expect(k.quickRatio).toBe(111.1); expect(k.dso).toBe(37);
  });
});
