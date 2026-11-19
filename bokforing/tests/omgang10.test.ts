import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { canReceive, eventScope, parseScopes, pkceOk, validRedirectUri } from '@/lib/oauth';

describe('OAuth', () => {
  it('återkomstadresser', () => {
    expect(validRedirectUri('https://app.example.com/cb')).toBe(true);
    expect(validRedirectUri('http://localhost:3000/cb')).toBe(true);
    expect(validRedirectUri('http://example.com/cb')).toBe(false);
    expect(validRedirectUri('https://a.example/cb#x')).toBe(false);
    expect(validRedirectUri('javascript:alert(1)')).toBe(false);
    expect(validRedirectUri('https://user:pw@a.example/')).toBe(false);
  });
  it('PKCE S256', () => {
    const v = 'a'.repeat(50), c = createHash('sha256').update(v).digest('base64url');
    expect(pkceOk(v, c)).toBe(true);
    expect(pkceOk('b'.repeat(50), c)).toBe(false);
    expect(pkceOk('kort', c)).toBe(false);
  });
  it('behörigheter', () => {
    const k = new Set(['sales:read', 'sales:write']);
    expect(parseScopes('sales:read sales:read,sales:write', k)).toEqual(['sales:read', 'sales:write']);
    expect(() => parseScopes('payroll:read', k)).toThrow(/Okända/);
    expect(() => parseScopes(' ', k)).toThrow();
  });
  it('händelser kräver läsbehörighet för området', () => {
    expect(eventScope('invoice.paid')).toBe('sales:read');
    expect(eventScope('payroll_run.booked')).toBe('payroll:read');
    expect(eventScope('crm.deal.won')).toBe('crm:read');
    expect(canReceive('invoice.paid', ['sales:read'])).toBe(true);
    expect(canReceive('employee.updated', ['sales:read', 'sales:write'])).toBe(false);
    expect(canReceive('invoice.paid', ['sales:write'])).toBe(true);
  });
});

import { allowanceDays, matchReceipts } from '@/lib/cards';
describe('Företagskort och resor', () => {
  it('kortköp matchas mot kvitton: belopp, datum, butik', () => {
    const tx = [{ id: 1, date: '2026-11-10', amount: -12500, text: 'KORTKÖP ICA MAXI' }, { id: 2, date: '2026-11-11', amount: -12500, text: 'KORTKÖP CIRCLE K' }, { id: 3, date: '2026-11-12', amount: -999, text: 'X' }];
    const rc = [{ id: 10, date: '2026-11-11', amount: 12500, text: 'Drivmedel Circle K' }, { id: 11, date: '2026-11-10', amount: 12500, text: 'Fika ICA' }, { id: 12, date: '2026-11-20', amount: 999, text: 'X' }];
    expect(matchReceipts(tx, rc)).toEqual([{ txId: 1, voucherId: 11 }, { txId: 2, voucherId: 10 }]);
  });
  it('traktamente efter tider', () => {
    expect(allowanceDays('2026-11-10T07:00', '2026-11-12T20:00')).toEqual({ full: 3, half: 0, nights: 2 });
    expect(allowanceDays('2026-11-10T13:00', '2026-11-11T15:00')).toEqual({ full: 0, half: 2, nights: 1 });
    expect(allowanceDays('2026-11-10T08:00', '2026-11-10T22:00')).toEqual({ full: 0, half: 0, nights: 0 });
    expect(() => allowanceDays('2026-11-10T08:00', '2026-11-09T08:00')).toThrow();
  });
});
