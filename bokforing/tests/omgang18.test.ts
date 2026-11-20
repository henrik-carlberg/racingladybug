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

import { adjustment, adjustmentLines, deductionShare, parseVatNumber, proportionLines } from '@/lib/vat-advanced';
describe('Moms på djupet', () => {
  it('avdragsandel avrundas uppåt', () => {
    expect(deductionShare(6000000, 4000000)).toBe(60);
    expect(deductionShare(6010000, 3990000)).toBe(61);
    expect(deductionShare(0, 0)).toBe(100);
  });
  it('proportionering av gemensam ingående moms', () => {
    const r = proportionLines([{ vat: 250000, costs: [{ account: 5010, amount: 1000000 }] }, { vat: 25000, costs: [{ account: 6110, amount: 100000 }] },
      { vat: 50000, costs: [{ account: 5010, amount: 100000 }, { account: 4010, amount: 100000 }] }], [5010], 60);
    expect(r.commonVat).toBe(275000);
    expect(r.lines).toEqual([{ account: 5010, amount: 110000 }, { account: 2641, amount: -110000 }]);
  });
  it('jämkning av fastighet och inventarie', () => {
    const f = { vat: 20000000, kind: 'fastighet' as const, completedYear: 2025, origPct: 100 };
    expect(adjustment(f, 2026, 60).amount).toBe(-800000);
    expect(adjustment(f, 2026, 95).amount).toBe(0);
    expect(adjustment(f, 2035, 50).amount).toBe(0);
    expect(adjustment({ ...f, kind: 'inventarie', origPct: 50 }, 2027, 80).amount).toBe(1200000);
    expect(adjustmentLines(-800000)).toEqual([{ account: 7999, amount: 800000 }, { account: 2641, amount: -800000 }]);
  });
  it('momsregistreringsnummer', () => {
    expect(parseVatNumber('de 123 456 789')).toEqual({ country: 'DE', number: '123456789', full: 'DE123456789' });
    expect(parseVatNumber('GR123456789')?.country).toBe('EL');
    expect(parseVatNumber('US123')).toBeNull();
  });
});

import { contributionLines, transferTax } from '@/lib/ownership-change';
describe('Ägarbyte och generationsskifte', () => {
  it('försäljning: kapitalvinst och nytt omkostnadsbelopp', () => {
    const t = transferTax({ kind: 'sale', price: 50000000, sellerShares: 1000, shares: 400, sellerCost: 2500000, sellerSaved: 10000000 });
    expect(t).toMatchObject({ asSale: true, movedCost: 1000000, buyerCost: 50000000, buyerSaved: 0, gain: 49000000, sellerCostAfter: 1500000, sellerSavedAfter: 6000000 });
  });
  it('gåva: omkostnadsbelopp och sparat utrymme följer med; gåva med för hög ersättning blir försäljning', () => {
    expect(transferTax({ kind: 'gift', price: 0, sellerShares: 1000, shares: 500, sellerCost: 2500000, sellerSaved: 10000000 })).toMatchObject({ asSale: false, buyerCost: 1250000, buyerSaved: 5000000, gain: 0 });
    expect(transferTax({ kind: 'gift', price: 2000000, sellerShares: 1000, shares: 500, sellerCost: 2500000, sellerSaved: 0 }).asSale).toBe(true);
    expect(contributionLines(100)).toEqual([{ account: 1930, amount: 100 }, { account: 2093, amount: -100 }]);
  });
});
