import { describe, expect, it } from 'vitest';
import { assess, settleLines, unregistered } from '@/lib/owner-loans';

describe('Låneförbudet', () => {
  it('förbjudna och tillåtna lån', () => {
    expect(assess({ relation: 'owner', purpose: 'private', amount: 100, repaid: 0 }, true)).toMatchObject({ prohibited: true, taxedAsSalary: true, outstanding: 100 });
    expect(assess({ relation: 'owner', purpose: 'private', amount: 100, repaid: 100 }, true)).toMatchObject({ prohibited: false });
    expect(assess({ relation: 'related_company', purpose: 'business', amount: 100, repaid: 0 }, true).prohibited).toBe(false);
    expect(assess({ relation: 'related_company', purpose: 'private', amount: 100, repaid: 0 }, true)).toMatchObject({ prohibited: true, taxedAsSalary: false });
    expect(assess({ relation: 'group_company', purpose: 'private', amount: 100, repaid: 0 }, true).prohibited).toBe(false);
    expect(assess({ relation: 'board', purpose: 'private', amount: 100, repaid: 0 }, false)).toMatchObject({ prohibited: true, taxedAsSalary: false });
    expect(settleLines('dividend', 50)).toEqual([{ account: 2898, amount: 50 }, { account: 1685, amount: -50 }]);
    expect(unregistered(100, 30)).toBe(70);
  });
});
