import { describe, expect, it } from 'vitest';
import { learnKey, normalizeText, pickRule, ruleMatches, type BankRule } from '@/lib/bank/rules';
import { computeReduction, labourInclVat, reductionErrors, remainingForBuyer } from '@/lib/rotrut';
import { computeInvoice, invoiceBookingLines, type InvoiceLineInput } from '@/lib/invoice';

const rule = (p: Partial<BankRule>): BankRule => ({ id: 1, name: 'r', pattern: 'telia', direction: 'any', amountMin: null, amountMax: null, account: 6212, vatRate: 25, description: '', auto: false, priority: 0, ...p });
const tx = (description: string, amount = -49900, counterparty = '') => ({ amount, description, reference: '', counterparty });

describe('Konteringsregler', () => {
  it('normaliserar bankens texter', () => {
    expect(normalizeText('KORTKÖP 261103 TELIA SVERIGE AB')).toBe('telia sverige');
    expect(learnKey(tx('BG 5050-1055 Kontorsvaror Norden AB faktura 77'))).toBe('kontorsvaror norden');
    expect(learnKey(tx('x', -1, 'Fortnox AB'))).toBe('fortnox');
  });
  it('sökord matchar hela ord, * matchar början', () => {
    expect(ruleMatches(rule({}), tx('KORTKÖP TELIA SVERIGE'))).toBe(true);
    expect(ruleMatches(rule({}), tx('KORTKÖP TELIAKONTO'))).toBe(false);
    expect(ruleMatches(rule({ pattern: 'telia*' }), tx('KORTKÖP TELIAKONTO'))).toBe(true);
    expect(ruleMatches(rule({ pattern: 'google cloud' }), tx('GOOGLE *CLOUD EMEA'))).toBe(true);
    expect(ruleMatches(rule({ pattern: 'google cloud' }), tx('GOOGLE ADS'))).toBe(false);
  });
  it('riktning och belopp', () => {
    expect(ruleMatches(rule({ direction: 'out' }), tx('telia', 10000))).toBe(false);
    expect(ruleMatches(rule({ direction: 'in' }), tx('telia', 10000))).toBe(true);
    expect(ruleMatches(rule({ amountMax: 100000 }), tx('telia', -150000))).toBe(false);
    expect(ruleMatches(rule({ amountMin: 100000 }), tx('telia', -150000))).toBe(true);
  });
  it('mest specifika regeln vinner, prioritet först', () => {
    const rules = [rule({ id: 1, pattern: 'avgift', account: 6570 }), rule({ id: 2, pattern: 'telia avgift', account: 6212 }), rule({ id: 3, pattern: 'avgift', account: 6991, priority: -1 })];
    expect(pickRule(rules, tx('TELIA AVGIFT'))?.id).toBe(2);
    expect(pickRule(rules, tx('BANKENS AVGIFT'))?.id).toBe(1);
    expect(pickRule([...rules, rule({ id: 4, pattern: 'avgift', priority: 5, account: 6990 })], tx('TELIA AVGIFT'))?.id).toBe(4);
    expect(pickRule(rules, tx('ICA'))).toBe(null);
  });
});

describe('ROT och RUT', () => {
  const lines: InvoiceLineInput[] = [
    { description: 'Målning', quantity: 10, unit: 'h', unitPrice: 50000, vatRate: 25, account: 3001, labor: true },
    { description: 'Färg', quantity: 1, unit: 'st', unitPrice: 200000, vatRate: 25, account: 3001 },
  ];
  const t = computeInvoice(lines);
  it('avdrag på arbetskostnad inkl. moms, nedåt till hela kronor', () => {
    expect(labourInclVat(lines, t)).toBe(625000);
    expect(computeReduction('rot', 625000)).toEqual({ reduction: 187500, uncapped: 187500, capped: false });
    expect(computeReduction('rut', 625050).reduction).toBe(312500); // 3 125,25 → 3 125
    expect(computeReduction('rot', 625000, 100050)).toEqual({ reduction: 100000, uncapped: 187500, capped: true });
    expect(computeReduction('rot', 0).reduction).toBe(0);
  });
  it('årstak per köpare', () => {
    expect(remainingForBuyer('rot', { rot: 0, rut: 0 })).toBe(5_000_000);
    expect(remainingForBuyer('rut', { rot: 0, rut: 0 })).toBe(7_500_000);
    expect(remainingForBuyer('rut', { rot: 5_000_000, rut: 0 })).toBe(2_500_000);
    expect(remainingForBuyer('rot', { rot: 1_000_000, rut: 6_000_000 })).toBe(500_000);
    expect(remainingForBuyer('rot', { rot: 4_000_000, rut: 1_000_000 })).toBe(1_000_000);
    expect(computeReduction('rot', 100_000_000).reduction).toBe(5_000_000);
  });
  it('konteringen: kunden 1510, Skatteverket 1513, balanserar', () => {
    const v = invoiceBookingLines(lines, t, 1, 187500);
    const get = (a: number) => v.filter((l) => l.account === a).reduce((s, l) => s + l.debit - l.credit, 0);
    expect(get(1510)).toBe(875000 - 187500);
    expect(get(1513)).toBe(187500);
    expect(get(3001)).toBe(-700000);
    expect(get(2611)).toBe(-175000);
    expect(v.reduce((s, l) => s + l.debit - l.credit, 0)).toBe(0);
  });
  it('kontroller', () => {
    const info = { type: 'rot' as const, buyerPnr: '191212121212', property: '', brfOrgnr: '', apartmentNo: '', workType: 'Målning' };
    expect(reductionErrors(info, { labour: 1, fSkatt: true, pnrValid: true })).toEqual(['ROT kräver fastighetsbeteckning, eller bostadsrättsföreningens org.nr och lägenhetsnummer']);
    expect(reductionErrors({ ...info, brfOrgnr: '769600-1234', apartmentNo: '1101' }, { labour: 1, fSkatt: true, pnrValid: true })).toEqual([]);
    expect(reductionErrors({ ...info, type: 'rut', workType: '' }, { labour: 0, fSkatt: false, pnrValid: false })).toHaveLength(4);
    expect(reductionErrors({ ...info, type: null }, { labour: 0, fSkatt: false, pnrValid: false })).toEqual([]);
  });
});
