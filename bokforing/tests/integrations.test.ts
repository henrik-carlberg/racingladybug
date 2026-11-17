import { describe, it, expect, vi } from 'vitest';
import { compile, hasScope, matchRoute, type ApiRoute } from '@/lib/api/router';
import { backoffMinutes, isPublicIp, signPayload, verifySignature, MAX_ATTEMPTS } from '@/lib/webhook-utils';
import { CORE_EVENTS } from '@/lib/events-catalog';

vi.mock('server-only', () => ({}));

const r = (method: ApiRoute['method'], path: string): ApiRoute => ({ method, path, scope: 'x:read', summary: '', handler: async () => null });

describe('API-router', () => {
  const routes = [r('GET', '/invoices'), r('POST', '/invoices'), r('GET', '/invoices/:id'), r('POST', '/invoices/:id/book')];
  it('matchar sökväg och parametrar', () => {
    const m = matchRoute(routes, 'POST', '/invoices/42/book');
    expect(m && 'route' in m && m.params).toEqual({ id: '42' });
    expect(matchRoute(routes, 'GET', '/invoices/')).toMatchObject({ route: routes[0] });
    expect(matchRoute(routes, 'GET', '/okand')).toBeNull();
  });
  it('ger 405-information när metoden saknas', () => {
    expect(matchRoute(routes, 'DELETE', '/invoices')).toEqual({ allowed: ['GET', 'POST'] });
  });
  it('kompilerar mönster', () => {
    expect(compile('/a/:x/b/:y').keys).toEqual(['x', 'y']);
    expect(compile('/a/:x').re.test('/a/1/2')).toBe(false);
  });
});

describe('scopes', () => {
  it('write innefattar read', () => {
    expect(hasScope(['sales:write'], 'sales:read')).toBe(true);
    expect(hasScope(['sales:read'], 'sales:write')).toBe(false);
    expect(hasScope(['sales:write'], 'payroll:read')).toBe(false);
    expect(hasScope(['crm:read'], 'crm:read')).toBe(true);
  });
});

describe('webhook-signatur', () => {
  it('signerar och verifierar', () => {
    const body = JSON.stringify({ a: 1 });
    const now = 1_767_225_600_000;
    const h = signPayload('whsec_test', body, now / 1000);
    expect(verifySignature('whsec_test', body, h, 300, now)).toBe(true);
    expect(verifySignature('whsec_fel', body, h, 300, now)).toBe(false);
    expect(verifySignature('whsec_test', body + ' ', h, 300, now)).toBe(false);
    expect(verifySignature('whsec_test', body, h, 300, now + 10 * 60_000)).toBe(false); // för gammal
  });
  it('backoff och maxförsök', () => {
    expect(backoffMinutes(1)).toBe(1);
    expect(backoffMinutes(7)).toBe(1440);
    expect(backoffMinutes(MAX_ATTEMPTS)).toBeNull();
  });
});

describe('SSRF-skydd', () => {
  it('blockerar interna adresser', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1'])
      expect(isPublicIp(ip), ip).toBe(false);
    for (const ip of ['8.8.8.8', '172.32.0.1', '2a00:1450:4001::200e']) expect(isPublicIp(ip), ip).toBe(true);
  });
});

describe('moduler', async () => {
  const { MODULES } = await import('@/modules/registry');
  it('har unika id:n och följer namnreglerna', () => {
    const ids = MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    const core = new Set(CORE_EVENTS.map((e) => e.type));
    for (const m of MODULES) {
      expect(m.id).toMatch(/^[a-z0-9-]+$/);
      for (const s of m.scopes ?? []) expect(s.scope.startsWith(`${m.id}:`), s.scope).toBe(true);
      for (const e of m.events ?? []) {
        expect(e.type.startsWith(`${m.id}.`), e.type).toBe(true);
        expect(core.has(e.type)).toBe(false);
      }
      const scopes = new Set((m.scopes ?? []).map((s) => s.scope));
      for (const a of m.api ?? []) expect(scopes.has(a.scope), `${m.id} ${a.method} ${a.path}`).toBe(true);
    }
  });
});
