import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseAmount, formatAmount } from '@/lib/money';
import { makeOcr, isValidOcr, normalizePersonalNumber, normalizeOrgNumber, agiId } from '@/lib/validate';
import { computeInvoice, invoiceBookingLines } from '@/lib/invoice';
import { supplierInvoiceLines } from '@/lib/supplier';
import { totals, reverseLines } from '@/lib/ledger-lines';
import { vatReport, vatSettlementLines } from '@/lib/vat';
import { employerFee, taxFromTable, calculatePayslip, payrollBookingLines, type TaxTableRow } from '@/lib/payroll';
import { buildAgiXml } from '@/lib/agi';
import { buildSie4, encodeCp437 } from '@/lib/sie';

describe('belopp', () => {
  it('tolkar svenska format', () => {
    expect(parseAmount('1 234,50')).toBe(123450);
    expect(parseAmount('1234.5')).toBe(123450);
    expect(parseAmount('-12')).toBe(-1200);
    expect(parseAmount('1.234,05')).toBe(123405);
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('1,234')).toBeNull();
  });
  it('formaterar', () => {
    expect(formatAmount(123450)).toBe('1 234,50');
    expect(formatAmount(-5)).toBe('-0,05');
  });
});

describe('validering', () => {
  it('OCR med längd- och kontrollsiffra', () => {
    const ocr = makeOcr(1001);
    expect(ocr).toHaveLength(6);
    expect(isValidOcr(ocr)).toBe(true);
    expect(isValidOcr('100161')).toBe(false);
  });
  it('personnummer', () => {
    expect(normalizePersonalNumber('19811218-9876')).toBe('198112189876');
    expect(normalizePersonalNumber('811218-9876', new Date('2026-01-01'))).toBe('198112189876');
    expect(normalizePersonalNumber('19811218-9875')).toBeNull();
  });
  it('organisationsnummer', () => {
    expect(normalizeOrgNumber('5560269986')).toBe('556026-9986');
    expect(normalizeOrgNumber('556026-9987')).toBeNull();
    expect(agiId('556026-9986', 'AB')).toBe('165560269986');
  });
});

describe('kundfaktura', () => {
  const lines = [
    { description: 'Konsult', quantity: 10, unit: 'h', unitPrice: 95000, vatRate: 25 as const, account: 3001 },
    { description: 'Bok', quantity: 1, unit: 'st', unitPrice: 19950, vatRate: 6 as const, account: 3003 },
  ];
  it('räknar moms per sats och öresavrundar', () => {
    const t = computeInvoice(lines);
    expect(t.net).toBe(969950);
    expect(t.vatByRate[25].vat).toBe(237500);
    expect(t.vatByRate[6].vat).toBe(1197);
    expect(t.total).toBe(1208600); // 12 086,47 → 12 086
    expect(t.rounding).toBe(-47);
  });
  it('konterar balanserat', () => {
    const t = computeInvoice(lines);
    const b = invoiceBookingLines(lines, t);
    expect(totals(b).balanced).toBe(true);
    expect(b.find((l) => l.account === 1510)?.debit).toBe(1208600);
    expect(b.find((l) => l.account === 2611)?.credit).toBe(237500);
    expect(b.find((l) => l.account === 3740)?.debit).toBe(47);
    const credit = invoiceBookingLines(lines, t, -1);
    expect(credit.find((l) => l.account === 1510)?.credit).toBe(1208600);
  });
  it('omvänd skattskyldighet ger ingen moms', () => {
    const t = computeInvoice(lines, { reverseCharge: true });
    expect(t.vat).toBe(0);
  });
});

describe('leverantörsfaktura', () => {
  it('konterar och kontrollerar summan', () => {
    const l = supplierInvoiceLines([{ account: 5010, amount: 800000 }], 200000, 1000000);
    expect(totals(l).balanced).toBe(true);
    expect(l.find((x) => x.account === 2440)?.credit).toBe(1000000);
    expect(() => supplierInvoiceLines([{ account: 5010, amount: 1 }], 0, 2)).toThrow();
  });
  it('rättelse vänder sidorna', () => {
    const l = supplierInvoiceLines([{ account: 5010, amount: 800000 }], 200000, 1000000);
    expect(reverseLines(l).find((x) => x.account === 2440)?.debit).toBe(1000000);
  });
});

describe('moms', () => {
  const sums = new Map([
    [3001, -1000000], [2611, -250000], [3003, -10000], [2631, -600], [2641, 50033], [3308, -500000],
  ]);
  it('momsdeklarationens rutor', () => {
    const r = vatReport(sums);
    const box = (b: string) => r.boxes.find((x) => x.box === b)!.amount;
    expect(box('05')).toBe(1010000);
    expect(box('10')).toBe(250000);
    expect(box('12')).toBe(600);
    expect(box('39')).toBe(500000);
    expect(box('48')).toBe(50033);
    expect(r.toPay).toBe(200500); // 2 005,67 → 2 005 kr
  });
  it('momsavräkning balanserar', () => {
    const l = vatSettlementLines(sums);
    expect(totals(l).balanced).toBe(true);
    expect(l.find((x) => x.account === 2650)?.credit).toBe(200500);
    expect(l.find((x) => x.account === 3740)?.credit).toBe(67);
  });
});

const table32: TaxTableRow[] = [
  { income_from: 35001, income_to: 35200, kind: 'B', columns: [6970, 6821, 3717, 6970, 10656, 10656] },
  { income_from: 1655801, income_to: 2147483647, kind: '%', columns: [51, 51, 51, 44, 51, 51] },
];

describe('lön', () => {
  it('arbetsgivaravgift efter ålder och datum', () => {
    expect(employerFee(3000000, 1985, '2026-05-25').fee).toBe(942600);
    expect(employerFee(3000000, 1959, '2026-05-25').effectiveRate).toBe(10.21);
    expect(employerFee(3000000, 1937, '2026-05-25').fee).toBe(0);
    // 19–23 år: 20,81 % upp till 25 000, 31,42 % på resten
    expect(employerFee(3000000, 2005, '2026-05-25').fee).toBe(520250 + 157100);
    // före 1 april 2026 gäller full avgift
    expect(employerFee(3000000, 2005, '2026-03-25').fee).toBe(942600);
    expect(employerFee(3000000, 1985, '2026-05-25', 10.21).fee).toBe(306300);
  });
  it('skatt från tabell', () => {
    expect(taxFromTable(3510000, table32, 1)).toBe(697000);
    expect(taxFromTable(2000000000, table32, 1)).toBe(1020000000);
  });
  it('lönespec och kontering', () => {
    const items = [
      { type: 'salary' as const, description: 'Månadslön', amount: 3500000 },
      { type: 'salary' as const, description: 'Övertid', amount: 10000 },
      { type: 'benefit' as const, description: 'Friskvård', amount: 0 },
      { type: 'reimbursement' as const, description: 'Utlägg', amount: 25000, account: 5800 },
      { type: 'net_deduction' as const, description: 'Lunch', amount: 5000 },
    ];
    const c = calculatePayslip(items, { mode: 'table', rows: table32, column: 1 }, 1985, '2026-05-25');
    expect(c.tax).toBe(697000);
    expect(c.netPay).toBe(3510000 - 697000 - 5000 + 25000);
    expect(c.employerFee).toBe(1102842);
    const l = payrollBookingLines([{ calc: c, items }]);
    expect(totals(l).balanced).toBe(true);
    expect(l.find((x) => x.account === 1930)?.credit).toBe(c.netPay);
  });
});

describe('AGI', () => {
  it('validerar mot Skatteverkets schema', () => {
    const xml = buildAgiXml({
      period: '2026-05',
      employer: { agId: '165560269986', contactName: 'Test Testsson', contactPhone: '0701234567', contactEmail: 'test@example.com' },
      individuals: [{ personalNumber: '198112189876', specNumber: 1, grossCash: 3510000, benefits: 50000, tax: 697000 }],
      totalEmployerFees: 1118552,
      totalTax: 697000,
      created: new Date('2026-06-01T10:00:00'),
    });
    expect(xml).toContain('<agd:KontantErsattningUlagAG faltkod="011">35100</agd:KontantErsattningUlagAG>');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agi-'));
    const file = path.join(dir, 'agi.xml');
    fs.writeFileSync(file, xml);
    const xsd = path.resolve(__dirname, 'fixtures/agi/arbetsgivardeklaration_1.1.xsd');
    const res = execFileSync('xmllint', ['--noout', '--schema', xsd, file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(res).toBe('');
  });
});

describe('SIE', () => {
  it('bygger SIE4 och kodar CP437', () => {
    const s = buildSie4({
      companyName: 'Testbolag "Åkeri" AB', orgnr: '556026-9986',
      fiscalYear: { start: '2026-01-01', end: '2026-12-31' },
      accounts: [{ number: 1930, name: 'Företagskonto' }, { number: 3001, name: 'Försäljning' }],
      openingBalances: new Map([[1930, 100000]]), closingBalances: new Map([[1930, 225000]]),
      results: new Map([[3001, -125000]]),
      vouchers: [{ series: 'A', number: 1, date: '2026-02-01', description: 'Försäljning', created: '2026-02-01',
        lines: [{ account: 1930, amount: 125000 }, { account: 3001, amount: -125000 }] }],
      generated: new Date('2026-03-01'),
    });
    expect(s).toContain('#FNAMN "Testbolag \\"Åkeri\\" AB"');
    expect(s).toContain('#TRANS 3001 {} -1250.00');
    expect(s).toContain('#IB 0 1930 1000.00');
    const bytes = encodeCp437('åäöÅÄÖ');
    expect([...bytes]).toEqual([0x86, 0x84, 0x94, 0x8f, 0x8e, 0x99]);
  });
});
