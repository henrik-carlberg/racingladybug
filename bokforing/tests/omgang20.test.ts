import { describe, expect, it } from 'vitest';
import { boxDiff, correctionLines, diffSums, dueDate } from '@/lib/vat-correction';
import { dateChecks } from '@/lib/checks';

describe('Rättelse av momsdeklaration', () => {
  const declared = new Map([[3001, -100000], [2611, -25000], [1930, 125000]]);
  const current = new Map([[3001, -140000], [2611, -35000], [1930, 175000]]);
  it('differens per ruta och rättelseverifikation', () => {
    expect(diffSums(current, declared)).toEqual(new Map([[3001, -40000], [2611, -10000], [1930, 50000]]));
    const b = boxDiff(current, declared);
    expect(b.rows.map((r) => [r.box, r.diff])).toEqual(expect.arrayContaining([['05', 40000], ['10', 10000], ['49', 10000]]));
    expect(b.toPayDiff).toBe(10000);
    expect(correctionLines(current, declared)).toEqual([{ account: 2611, debit: 10000, credit: 0 }, { account: 2650, debit: 0, credit: 10000 }]);
    expect(correctionLines(declared, declared)).toEqual([]);
    expect(dueDate('2026-01-31')).toBe('2026-03-12');
  });
  it('varning när datumet ligger i en deklarerad period', () => {
    const c = dateChecks('2026-01-20', { lockedUntil: null, fiscalYears: [{ start: '2026-01-01', end: '2026-12-31', closed: false }], vatDeclared: [{ from: '2026-01-01', to: '2026-01-31' }] }, '2026-02-01');
    expect(c.some((x) => x.text.includes('redan deklarerad'))).toBe(true);
  });
});
