import { describe, expect, it } from 'vitest';
import { depreciationMethods, yearEndProposals } from '@/lib/tax-planning';

describe('Inventarier i bokslutet', () => {
  const inv = { bookStart: 0, overStart: 0, acquisitions: 10000000, disposals: 0, bookedDepreciation: 0, byYear: [{ yearsHeld: 1, cost: 10000000 }], bookEnd: 10000000, reserveNow: 5000000 };
  it('tre metoder, högsta reserv och obligatorisk återföring', () => {
    const d = depreciationMethods(inv);
    expect(d.rows.map((r) => r.taxValue)).toEqual([7000000, 8000000, 7500000]);
    expect(d).toMatchObject({ lowest: 7000000, maxReserve: 3000000, reversal: 2000000, room: 0 });
    const p = yearEndProposals({ type: 'AB', year: 2026, resultBeforeAppropriations: 10000000, nonDeductible: 0, inventories: inv });
    const r = p.proposals.find((x) => x.kind === 'aterforing_overavskrivning')!;
    expect(r).toMatchObject({ amount: 2000000, required: true });
    expect(r.lines).toEqual([{ account: 2150, amount: 2000000 }, { account: 8853, amount: -2000000 }]);
    expect(p.proposals.some((x) => x.kind === 'overavskrivning')).toBe(false);
  });
  it('utrymme för ny överavskrivning begränsas av högsta reserv', () => {
    const p = yearEndProposals({ type: 'AB', year: 2026, resultBeforeAppropriations: 10000000, nonDeductible: 0, inventories: { ...inv, reserveNow: 1000000 } });
    expect(p.proposals.find((x) => x.kind === 'overavskrivning')?.amount).toBe(2000000);
  });
});
