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
