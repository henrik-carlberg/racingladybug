import { describe, expect, it } from 'vitest';
import { confirmedLossLines, recoveryLines, reserveProposal, vatShare } from '@/lib/bad-debts';

describe('Kundförluster', () => {
  const inv = [{ account: 1510, amount: 1250000 }, { account: 3001, amount: -1000000 }, { account: 2611, amount: -250000 }];
  it('konstaterad förlust sätter ned momsen i proportion till det som återstår', () => {
    expect(confirmedLossLines(inv, 1250000)).toEqual([{ account: 6351, amount: 1000000 }, { account: 2611, amount: 250000 }, { account: 1510, amount: -1250000 }]);
    expect(vatShare(inv, 625000)).toMatchObject({ total: 125000, net: 500000 });
    expect(recoveryLines(inv, 250000, 1930)).toEqual([{ account: 1930, amount: 250000 }, { account: 6351, amount: -200000 }, { account: 2611, amount: -50000 }]);
    // Omvänd skattskyldighet: ingen moms att sätta ned
    expect(confirmedLossLines([{ account: 1510, amount: 1000000 }, { account: 3231, amount: -1000000 }], 1000000)).toEqual([{ account: 6351, amount: 1000000 }, { account: 1510, amount: -1000000 }]);
  });
  it('reserv för befarade förluster exklusive moms, ändring mot befintlig reserv', () => {
    const c = [{ id: 1, number: 1, customer: 'A', due: '2026-03-01', remaining: 500000, net: 400000, collection: false },
      { id: 2, number: 2, customer: 'B', due: '2026-12-01', remaining: 125000, net: 100000, collection: true },
      { id: 3, number: 3, customer: 'C', due: '2026-12-01', remaining: 125000, net: 100000, collection: false }];
    const r = reserveProposal(c, '2026-12-31', 150000);
    expect(r.doubtful.map((d) => d.id)).toEqual([1, 2]);
    expect(r).toMatchObject({ target: 500000, change: 350000 });
    expect(r.lines).toEqual([{ account: 6352, amount: 350000 }, { account: 1519, amount: -350000 }]);
    expect(reserveProposal([], '2026-12-31', 150000).lines).toEqual([{ account: 6352, amount: -150000 }, { account: 1519, amount: 150000 }]);
  });
});
