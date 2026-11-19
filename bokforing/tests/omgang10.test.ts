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
