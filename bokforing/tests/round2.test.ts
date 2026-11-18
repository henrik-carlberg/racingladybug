import { describe, expect, it } from 'vitest';
import { proportionalLines } from '@/lib/partial';
import { fromSigned, type Line } from '@/lib/ledger-lines';

const sum = (ls: Line[], acc: number) => ls.filter((l) => l.account === acc).reduce((s, l) => s + l.debit - l.credit, 0);
const balanced = (ls: Line[]) => ls.reduce((s, l) => s + l.debit - l.credit, 0) === 0;

describe('delbetalningar (kontantmetoden)', () => {
  // Faktura 1 000 kr + 25 % moms = 1 250 kr
  const full = fromSigned([{ account: 1510, amount: 125000 }, { account: 3001, amount: -100000 }, { account: 2611, amount: -25000 }]);

  it('bokför betalningens andel av intäkt och moms', () => {
    const p = proportionalLines(full, 125000, 0, 50000, 1510, 1930);
    expect(balanced(p)).toBe(true);
    expect(sum(p, 1930)).toBe(50000);
    expect(sum(p, 3001)).toBe(-40000);
    expect(sum(p, 2611)).toBe(-10000);
  });

  it('summan av alla delbetalningar blir exakt hela konteringen', () => {
    const parts = [33333, 33333, 58334];
    let paid = 0;
    const all: Line[] = [];
    for (const a of parts) { const p = proportionalLines(full, 125000, paid, a, 1510, 1930); expect(balanced(p)).toBe(true); all.push(...p); paid += a; }
    expect(sum(all, 1930)).toBe(125000);
    expect(sum(all, 3001)).toBe(-100000);
    expect(sum(all, 2611)).toBe(-25000);
  });

  it('leverantörsfaktura: kostnad och ingående moms', () => {
    const si = fromSigned([{ account: 5410, amount: 80000 }, { account: 2641, amount: 20000 }, { account: 2440, amount: -100000 }]);
    const p = proportionalLines(si, 100000, 0, 30000, 2440, 1930);
    expect(sum(p, 1930)).toBe(-30000);
    expect(sum(p, 5410)).toBe(24000);
    expect(sum(p, 2641)).toBe(6000);
  });

  it('avvisar för stora eller ogiltiga belopp', () => {
    expect(() => proportionalLines(full, 125000, 100000, 30000, 1510, 1930)).toThrow();
    expect(() => proportionalLines(full, 125000, 0, 0, 1510, 1930)).toThrow();
  });
});

import { accrualSchedule, accruedEmployerFees, dueAccrualPeriods, vacationLiability } from '@/lib/accruals';
describe('periodiseringar', () => {
  it('fördelar jämnt med avrundningen på sista månaden', () => {
    const s = accrualSchedule(1000000, 12, '2026-11');
    expect(s).toHaveLength(12);
    expect(s[0]).toEqual({ period: '2026-11', amount: 83333 });
    expect(s[11]).toEqual({ period: '2027-10', amount: 83337 });
    expect(s.reduce((x, p) => x + p.amount, 0)).toBe(1000000);
  });
  it('bokför bara förfallna, obokförda månader', () => {
    const d = dueAccrualPeriods(120000, 12, '2026-01', '2026-03', new Set(['2026-01']));
    expect(d.map((p) => p.period)).toEqual(['2026-02', '2026-03']);
  });
  it('semesterlöneskuld och avgifter', () => {
    expect(vacationLiability(3500000, 10)).toBe(1610000);
    expect(vacationLiability(3500000, -2)).toBe(0);
    expect(accruedEmployerFees(1610000)).toBe(505862);
  });
});

import { normalizeReceipt } from '@/lib/receipts';
describe('kvittoavläsning', () => {
  it('rensar avläsningen', () => {
    expect(normalizeReceipt({ date: '2026-11-03', total_amount: 249.5, vat_rate: 12, category: 'personal_fika', description: 'Kaffe\noch bullar', merchant: 'Café Ett' }))
      .toEqual({ date: '2026-11-03', total: 24950, vatRate: 12, category: 'personal_fika', description: 'Kaffe och bullar', merchant: 'Café Ett' });
  });
  it('kastar ogiltiga värden', () => {
    const g = normalizeReceipt({ date: '3 nov', total_amount: -5, vat_rate: 20, category: 'okänd', description: null, merchant: null });
    expect(g).toEqual({ date: '', total: null, vatRate: null, category: '', description: '', merchant: '' });
  });
});

import { buildDigest, digestDue } from '@/lib/digest';
describe('e-postsammandrag', () => {
  const mon = new Date('2026-11-16T05:45:00Z'), tue = new Date('2026-11-17T05:45:00Z'), sat = new Date('2026-11-21T05:45:00Z');
  it('skickar veckovis på måndagar och dagligen på vardagar', () => {
    expect(digestDue('weekly', null, mon)).toBe(true);
    expect(digestDue('weekly', null, tue)).toBe(false);
    expect(digestDue('weekly', new Date('2026-11-16T05:45:00Z'), new Date('2026-11-16T12:00:00Z'))).toBe(false);
    expect(digestDue('daily', null, tue)).toBe(true);
    expect(digestDue('daily', null, sat)).toBe(false);
    expect(digestDue('off', null, mon)).toBe(false);
  });
  it('bygger ett sammandrag bara när något brådskar', () => {
    const base = { name: 'Anna Ek', origin: 'https://app.test', unsubscribeUrl: 'https://app.test/avregistrera/x', freq: 'weekly' as const };
    expect(buildDigest({ ...base, companies: [{ id: 1, name: 'AB', todos: [{ title: 'Utkast', count: 2, href: '/c/1/fakturor', level: 'info' }] }] })).toBeNull();
    const m = buildDigest({ ...base, companies: [{ id: 1, name: 'Ek AB', todos: [{ title: 'Förfallna kundfakturor', count: 3, href: '/c/1/fakturor', level: 'danger' }] }] })!;
    expect(m.subject).toBe('3 saker väntar i Ek AB');
    expect(m.text).toContain('Hej Anna!');
    expect(m.text).toContain('https://app.test/c/1/fakturor');
    expect(m.text).toContain('/avregistrera/x');
  });
});

import { decodeCsv, mapColumns, parseCsv, previewImport } from '@/lib/csv-import';
describe('CSV-import', () => {
  it('tolkar semikolon, citat och Windows-1252', () => {
    expect(parseCsv('Namn;Ort\n"Ek; AB";"Malmö ""C"""\n\n')).toEqual([['Namn', 'Ort'], ['Ek; AB', 'Malmö "C"']]);
    const latin = new Uint8Array([0x4f, 0x72, 0x74, 0x0a, 0x4d, 0x61, 0x6c, 0x6d, 0xf6]);
    expect(decodeCsv(latin)).toBe('Ort\nMalmö');
  });
  it('känner igen Fortnox-rubriker och föredrar restbelopp', () => {
    const m = mapColumns('customer_invoices', ['Fakturanr', 'Kundnamn', 'Fakturadatum', 'Förfallodatum', 'Total', 'Restbelopp', 'OCR']);
    expect(m.get(5)).toBe('amount');
    expect(m.get(4)).toBeUndefined();
  });
  it('validerar och räknar om belopp och datum', () => {
    const p = previewImport('customer_invoices', 'Fakturanummer;Kund;Fakturadatum;Förfallodatum;Restbelopp\n1042;Ek AB;2026-10-01;31.10.2026;1 250,50\nX1;Ek AB;2026-10-01;2026-10-31;10\n1043;Ek AB;2026-02-30;2026-10-31;10');
    expect(p.rows).toEqual([{ number: '1042', customer: 'Ek AB', invoice_date: '2026-10-01', due_date: '2026-10-31', amount: 125050 }]);
    expect(p.errors.map((e) => e.row)).toEqual([3, 4]);
  });
  it('anger saknade kolumner', () => {
    expect(previewImport('suppliers', 'Bankgiro\n123-4567').missing).toEqual(['name']);
  });
});
