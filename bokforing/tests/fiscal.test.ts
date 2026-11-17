import { describe, expect, it } from 'vitest';
import { defaultFiscalEnd, fiscalMonths, fiscalYearError } from '@/lib/fiscal';
import { computeDeadlines } from '@/lib/deadlines';
import { replaceAccount } from '@/lib/ledger-lines';

describe('räkenskapsår', () => {
  it('tillåter förlängt första år för enskild firma (31 okt – 31 dec året efter)', () => {
    expect(fiscalMonths('2026-10-31', '2027-12-31')).toBe(15);
    expect(fiscalYearError('2026-10-31', '2027-12-31', 'EF')).toBeNull();
  });
  it('kräver 31 december för enskild firma', () => {
    expect(fiscalYearError('2026-10-31', '2027-10-31', 'EF')).toMatch(/31 december/);
    expect(fiscalYearError('2026-05-01', '2027-04-30', 'AB')).toBeNull();
  });
  it('högst 18 månader och slut vid månadsskifte', () => {
    expect(fiscalYearError('2026-05-01', '2027-12-31', 'EF')).toMatch(/18 månader/);
    expect(fiscalYearError('2026-07-15', '2027-12-31', 'EF')).toBeNull();
    expect(fiscalYearError('2026-01-01', '2026-12-30', 'AB')).toMatch(/sista dagen/);
    expect(fiscalYearError('2026-01-01', '2026-01-01', 'AB')).toMatch(/efter startdatum/);
  });
  it('föreslår slutdatum', () => {
    expect(defaultFiscalEnd('2026-05-01', 'AB')).toBe('2027-04-30');
    expect(defaultFiscalEnd('2026-01-01', 'AB')).toBe('2026-12-31');
    expect(defaultFiscalEnd('2026-10-31', 'EF')).toBe('2026-12-31');
  });
});

describe('deadlines för enskild firma med förlängt år och kontantmetoden', () => {
  const list = computeDeadlines({
    companyType: 'EF', vatPeriod: 'year', fSkatt: true, fSkattFrom: '2027-03', hasEmployees: false,
    fiscalYears: [{ start: '2026-10-31', end: '2027-12-31' }], from: '2026-11-01', to: '2028-06-30',
  });
  it('en momsdeklaration för hela det förlängda året, 12 maj 2028', () => {
    const vat = list.filter((d) => d.kind === 'vat');
    expect(vat).toHaveLength(1);
    expect(vat[0].due).toBe('2028-05-12');
  });
  it('NE-bilagan för 2026/27 lämnas våren 2028', () => {
    expect(list.find((d) => d.kind === 'ink1')?.due).toBe('2028-05-02');
  });
  it('preliminärskatt först från startmånaden', () => {
    const prel = list.filter((d) => d.kind === 'prelskatt').map((d) => d.key);
    expect(prel[0]).toBe('prel:2027-03');
    expect(prel).not.toContain('prel:2026-12');
  });
});

describe('kontantmetoden', () => {
  it('byter kundfordran mot bank i konteringen', () => {
    const l = replaceAccount([{ account: 1510, debit: 125000, credit: 0 }, { account: 3010, debit: 0, credit: 100000 }, { account: 2611, debit: 0, credit: 25000 }], 1510, 1930);
    expect(l.map((x) => x.account)).toEqual([1930, 3010, 2611]);
  });
});
