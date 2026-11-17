import { describe, it, expect } from 'vitest';
import { computeDeadlines, ink2Due, nextWorkingDay, swedishNonWorkingDays, taxPeriod, yearlyVatDue } from '@/lib/deadlines';
import { ink2Form, neForm, sruBlankets, sruFields, sruInfo, latin1 } from '@/lib/taxforms';
import { annualReportHtml, keyFigures, type YearFigures } from '@/lib/annualreport';
import { sanitizeHtml } from '@/lib/sanitize';

describe('deadlines (verifierade mot Skatteverket)', () => {
  it('helgdagar och flytt till vardag', () => {
    const h = swedishNonWorkingDays(2027);
    expect(h.has('2027-03-26')).toBe(true); // långfredag
    expect(h.has('2027-03-29')).toBe(true); // annandag påsk
    expect(h.has('2027-06-25')).toBe(true); // midsommarafton
    expect(nextWorkingDay('2027-01-17')).toBe('2027-01-18'); // söndag
    expect(nextWorkingDay('2027-06-26')).toBe('2027-06-28'); // lördag
  });
  it('INK2, INK1 och årsmoms', () => {
    expect(ink2Due('2026-12-31')).toBe('2027-08-02'); // Skatteverket: "deklarera senast 2 augusti"
    expect(ink2Due('2026-06-30')).toBe('2027-01-15');
    expect(ink2Due('2027-04-30')).toBe('2027-12-01');
    expect(yearlyVatDue('EF', '2026-12-31')).toBe('2027-05-12');
    expect(yearlyVatDue('AB', '2026-12-31')).toBe('2027-08-17');
    expect(taxPeriod('2026-12-31')).toBe('2026P4');
    expect(taxPeriod('2027-06-30')).toBe('2027P2');
  });
  it('moms, AGI och preliminärskatt', () => {
    const d = computeDeadlines({ companyType: 'AB', vatPeriod: 'quarter', fiscalYears: [{ start: '2026-01-01', end: '2026-12-31' }], hasEmployees: true, fSkatt: true, from: '2026-01-01', to: '2027-12-31' });
    const due = (key: string) => d.find((x) => x.key === key)?.due;
    expect(due('vat:2026-04-01:2026-06-30')).toBe('2026-08-17'); // Q2 → 17 aug
    expect(due('vat:2026-01-01:2026-03-31')).toBe('2026-05-12');
    expect(due('vat:2026-10-01:2026-12-31')).toBe('2027-02-12');
    expect(due('agi:2026-12')).toBe('2027-01-18'); // december-lön → 17 jan (söndag) → 18 jan
    expect(due('agi:2026-07')).toBe('2026-08-17');
    expect(due('prel:2026-04')).toBe('2026-04-13'); // 12 april 2026 är söndag
    expect(due('ink2:2026-12-31')).toBe('2027-08-02');
    expect(due('arsredovisning:2026-12-31')).toBe('2027-07-31');
    expect(due('arsstamma:2026-12-31')).toBe('2027-06-30');
    const m = computeDeadlines({ companyType: 'EF', vatPeriod: 'month', fiscalYears: [{ start: '2026-01-01', end: '2026-12-31' }], hasEmployees: false, fSkatt: false, from: '2026-01-01', to: '2027-12-31' });
    expect(m.find((x) => x.key === 'vat:2026-11-01:2026-11-30')?.due).toBe('2027-01-18'); // november → 17 jan → måndag 18
    expect(m.find((x) => x.key === 'vat:2026-01-01:2026-01-31')?.due).toBe('2026-03-12');
    expect(m.find((x) => x.key === 'ink1:2026-12-31')?.due).toBe('2027-05-03'); // Skatteverket: "deklarera senast 3 maj"
    expect(m.some((x) => x.kind === 'agi' || x.kind === 'ink2')).toBe(false);
  });
});

// Ett enkelt AB-år: 100 000 försäljning, 30 000 kostnader, 14 420 skatt, aktiekapital 25 000
const abResult = new Map([[3001, -10000000], [6110, 2500000], [6072, 500000], [8910, 1442000]]);
const abClosing = new Map([[1930, 11058000], [1510, 1250000], [2081, -2500000], [2099, -5558000], [2611, -2500000], [2512, -1442000], [2893, -308000]]);

describe('INK2', () => {
  const f = ink2Form(abClosing, abResult, new Map());
  const box = (list: { box: string; amount: number; code: string }[], b: string) => list.find((x) => x.box === b);
  it('räkenskapsschema och skattemässigt resultat', () => {
    expect(box(f.income, '3.1')?.amount).toBe(10000000);
    expect(box(f.income, '3.7')?.amount).toBe(3000000);
    expect(box(f.income, '3.25')?.amount).toBe(1442000);
    expect(box(f.income, '3.26')).toMatchObject({ code: '7450', amount: 5558000 });
    expect(box(f.adjustments, '4.3c')?.amount).toBe(500000); // representation ej avdragsgill
    expect(f.taxable).toBe(5558000 + 1442000 + 500000);
    expect(box(f.page1, '1.1')).toMatchObject({ code: '7104', amount: 7500000 });
    expect(box(f.adjustments, '4.20')?.amount).toBe(308000); // lån från aktieägare
    expect(f.unmapped).toEqual([]);
  });
  it('balansräkningen balanserar', () => {
    const assets = f.balance.filter((x) => Number(x.box.split('.')[1]) <= 26).reduce((s, x) => s + x.amount, 0);
    const liab = f.balance.filter((x) => Number(x.box.split('.')[1]) > 26).reduce((s, x) => s + x.amount, 0);
    expect(assets).toBe(liab);
    expect(box(f.balance, '2.27')?.amount).toBe(2500000);
    expect(box(f.balance, '2.48')?.amount).toBe(2500000 + 308000);
  });
  it('SRU-filer', () => {
    const b = sruBlankets([{ form: 'INK2R-2026P4', id: '165560269986', name: 'Testbolaget AB', fyStart: '2026-01-01', fyEnd: '2026-12-31', fields: sruFields(f.income) }], new Date(2027, 2, 1, 10, 0, 0));
    expect(b).toContain('#BLANKETT INK2R-2026P4\r\n#IDENTITET 165560269986 20270301 100000\r\n#NAMN Testbolaget AB\r\n#UPPGIFT 7011 20260101\r\n#UPPGIFT 7012 20261231');
    expect(b).toContain('#UPPGIFT 7410 100000');
    expect(b).toContain('#UPPGIFT 7450 55580');
    expect(b.trim().endsWith('#FIL_SLUT')).toBe(true);
    const info = sruInfo({ id: '165560269986', name: 'Testbolaget AB', postalCode: '111 22', city: 'Stockholm' });
    expect(info).toContain('#ORGNR 165560269986');
    expect(info).toContain('#POSTNR 11122');
    expect(latin1('Ägare')[0]).toBe(0xc4);
  });
});

describe('NE', () => {
  const result = new Map([[3001, -50000000], [3004, -2000000], [5010, 6000000], [6072, 100000], [8310, -10000]]);
  const closing = new Map([[1930, 30000000], [1510, 5000000], [2010, -10000000], [2013, 12000000], [2019, -45910000], [2611, -1090000]]);
  it('R- och B-rutor', () => {
    const ne = neForm(closing, result);
    const f = (b: string) => [...ne.income, ...ne.balance, ...ne.adjustments].find((x) => x.box === b)!;
    expect(f('R1').amount).toBe(50000000);
    expect(f('R2').amount).toBe(2000000);
    expect(f('R4').amount).toBe(10000);
    expect(f('R6').amount).toBe(6100000);
    expect(f('R11').amount).toBe(52010000 - 6100000);
    expect(f('R13').amount).toBe(100000);
    expect(f('B9').amount).toBe(30000000);
    expect(f('B10').amount).toBe(35000000 - 1090000); // tillgångar − skulder
    expect(f('B16').amount).toBe(1090000);
  });
});

describe('årsredovisning K2', () => {
  const y: YearFigures = { label: '2026', start: '2026-01-01', end: '2026-12-31', result: abResult, closing: abClosing, opening: new Map([[1930, 2500000], [2081, -2500000]]) };
  it('nyckeltal och innehåll', () => {
    const k = keyFigures(y);
    expect(k.netSales).toBe(10000000);
    expect(k.result).toBe(5558000);
    expect(k.totalAssets).toBe(12308000);
    const html = annualReportHtml({ company: { name: 'Testbolaget AB', orgnr: '556026-9986', city: 'Stockholm' }, years: [y], activity: 'Konsultverksamhet.', events: '',
      dividend: 2000000, board: [{ name: 'Anna Andersson', role: 'Styrelseledamot' }], employees: 0, place: 'Stockholm' });
    for (const s of ['Förvaltningsberättelse', 'Flerårsöversikt', 'Resultatdisposition', 'Resultaträkning', 'Balansräkning', 'Not 1 Redovisningsprinciper', 'BFNAR 2016:10', 'Medelantalet anställda', 'Fastställelseintyg', 'Anna Andersson'])
      expect(html).toContain(s);
    expect(html).toContain('35 580'); // balanseras i ny räkning: 55 580 − 20 000
    // Sanering bevarar högerjustering men inget annat
    expect(sanitizeHtml(html)).toContain('style="text-align:right"');
  });
});
