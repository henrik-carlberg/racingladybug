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

import { board, summary } from '@/lib/firm-tasks';
describe('Byråns arbetstavla', () => {
  const dl = [
    { companyId: 1, company: 'A', key: 'moms:2026-11', title: 'Moms', due: '2026-11-12', status: 'overdue' as const, href: '/c/1' },
    { companyId: 2, company: 'B', key: 'ag:2026-12', title: 'AGI', due: '2026-12-12', status: 'upcoming' as const, href: '/c/2' },
    { companyId: 2, company: 'B', key: 'ink:2027', title: 'Ink', due: '2027-05-02', status: 'done' as const, href: '/c/2' },
  ];
  const tasks = [
    { id: 7, companyId: 2, deadlineKey: 'ag:2026-12', title: 'AGI', due: '2026-12-12', assignee: 5, assigneeName: 'Eva', status: 'open' as const },
    { id: 8, companyId: 1, deadlineKey: null, title: 'Underlag', due: '2026-11-25', assignee: null, assigneeName: null, status: 'open' as const },
  ];
  it('sorterar försenade, snart, kommande och slår ihop ansvarig', () => {
    const r = board(dl, tasks, '2026-11-20');
    expect(r.map((x) => [x.title, x.state])).toEqual([['Moms', 'overdue'], ['Underlag', 'soon'], ['AGI', 'upcoming']]);
    expect(r[2]).toMatchObject({ assigneeName: 'Eva', taskId: 7 });
    expect(summary(r)).toEqual({ overdue: 1, soon: 1, unassigned: 2 });
    expect(board(dl, tasks, '2026-11-20', { assignee: 5 }).map((x) => x.title)).toEqual(['AGI']);
    expect(board(dl, tasks, '2026-11-20', { showDone: true, companyId: 2 }).map((x) => x.state)).toEqual(['upcoming', 'done']);
  });
});

import { qcSummary, qualityChecks } from '@/lib/quality-checks';
describe('Kvalitetskontroller före bokslut', () => {
  it('ovanliga saldon, gamla avräkningskonton och moms', () => {
    const f = qualityChecks({ end: '2026-12-31',
      balances: new Map([[1930, -100], [1229, -5000], [1220, 9000], [2440, 300], [2890, -500], [1680, 200], [2611, -1000]]),
      year: new Map([[3001, -1000000], [2611, -100000], [6110, -50], [4990, -200], [3740, 30]]),
      lastMovement: new Map([[2890, '2026-01-10'], [1680, '2026-12-01']]) });
    const keys = f.map((x) => x.key);
    expect(keys).toEqual(expect.arrayContaining(['neg:1930', 'debit:2440', 'stale:2890', 'sign:6110', 'vat:out', 'vat:open']));
    expect(keys).not.toEqual(expect.arrayContaining(['neg:1229']));
    expect(keys.filter((k) => ['neg:1229', 'stale:1680', 'sign:4990', 'sign:3740'].includes(k))).toEqual([]);
    expect(qcSummary(f, new Set(['neg:1930']))).toMatchObject({ errors: 0, acked: 1 });
    expect(qualityChecks({ end: '2026-12-31', balances: new Map(), year: new Map([[3001, -1000000], [2611, -250000]]), lastMovement: new Map() })).toEqual([]);
  });
});
