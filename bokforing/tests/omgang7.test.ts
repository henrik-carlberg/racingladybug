import { describe, expect, it } from 'vitest';
import { findAnomalies, validateSuggestion } from '@/lib/ai-voucher';
import { integrationStatus } from '@/lib/integrations';

describe('AI-förslag på verifikation', () => {
  const accounts = new Set([1930, 2640, 5611, 5800]);
  it('kronor till öre, balans och okända konton', () => {
    const s = validateSuggestion({ date: '2026-11-18', description: 'Parkering', lines: [{ account: 5611, debit: 360, credit: 0 }, { account: 2640, debit: 90, credit: 0 }, { account: 1930, debit: 0, credit: 450 }], explanation: 'x', confidence: 'high' }, accounts, '2026-11-19');
    expect(s.problems).toEqual([]);
    expect(s.lines.map((l) => [l.account, l.debit, l.credit])).toEqual([[5611, 36000, 0], [2640, 9000, 0], [1930, 0, 45000]]);
    const bad = validateSuggestion({ date: 'i går', lines: [{ account: 9999, debit: 100, credit: 0 }, { account: 1930, debit: 0, credit: 90 }], confidence: 'super' }, accounts, '2026-11-19');
    expect(bad.date).toBe('2026-11-19');
    expect(bad.confidence).toBe('low');
    expect(bad.problems.join(' ')).toMatch(/9999.*BAS-kontoplanen.*inte lika/);
    expect(validateSuggestion({ lines: [{ account: 5800, debit: 100, credit: 0 }] }, accounts, '2026-11-19').problems).toContain('Förslaget har färre än två rader');
  });
});

describe('avvikelser', () => {
  const names = new Map([[6212, 'Mobiltelefon'], [5010, 'Lokalhyra']]);
  it('ovanligt hög kostnad och kostnad som saknas', () => {
    const m = new Map([
      [6212, new Map([['2026-04', 50000], ['2026-05', 52000], ['2026-06', 48000], ['2026-07', 50000], ['2026-08', 51000], ['2026-09', 49000], ['2026-10', 600000]])],
      [5010, new Map([['2026-07', 1200000], ['2026-08', 1200000], ['2026-09', 1200000]])],
    ]);
    const a = findAnomalies(m, '2026-10', names);
    expect(a.find((x) => x.account === 6212)).toMatchObject({ kind: 'high', amount: 600000 });
    expect(a.find((x) => x.account === 5010)).toMatchObject({ kind: 'missing', usual: 1200000 });
    // Små belopp larmar inte
    expect(findAnomalies(new Map([[6212, new Map([['2026-07', 1000], ['2026-08', 1000], ['2026-09', 1000], ['2026-10', 5000]])]]), '2026-10', names)).toEqual([]);
  });
});

describe('integrationer', () => {
  it('saknade variabler men aldrig värden', () => {
    const s = integrationStatus({ RESEND_API_KEY: 'hemligt', VAPID_PUBLIC_KEY: 'a', VAPID_PRIVATE_KEY: 'b' });
    expect(s.find((i) => i.key === 'mail')).toMatchObject({ configured: false, missing: ['MAIL_FROM'] });
    expect(s.find((i) => i.key === 'push')).toMatchObject({ configured: true, missingOptional: ['VAPID_SUBJECT'] });
    expect(JSON.stringify(s)).not.toContain('hemligt');
  });
});

import { sequenceGaps } from '@/lib/integrity';
describe('integritetskontroll', () => {
  it('luckor i nummerserier som intervall', () => {
    expect(sequenceGaps([1, 2, 3])).toEqual([]);
    expect(sequenceGaps([1, 2, 4, 8, 9])).toEqual(['3', '5–7']);
    expect(sequenceGaps([3])).toEqual(['1–2']);
    expect(sequenceGaps([])).toEqual([]);
  });
});

import { sysdocHtml } from '@/lib/sysdoc-html';
describe('systemdokumentation', () => {
  it('escapar allt från användare', () => {
    const html = sysdocHtml({ company: { name: '<script>alert(1)</script> AB', orgnr: '556', company_type: 'AB', address: '', postal_code: '', city: '', accounting_method: 'invoice', vat_period: 'quarter', locked_until: null, attest_threshold: null, attest_not_registrant: false, created_at: '2026-01-01' },
      years: [], accounts: [{ number: 1930, name: 'Bank"><img src=x onerror=alert(1)>', active: true }], users: [{ name: "O'Brien <b>", email: 'x', role: 'owner', permissions: null, since: '2026' }], firms: [], audit: [], changes: [], series: [],
      integrations: { bank: 0, inbox: false, autogiro: false, api_keys: 0, webhooks: 0, stripe: false, rules: 0 }, permissionNames: {}, version: 'x', generated: 'nu' } as never);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('O&#39;Brien &lt;b&gt;');
  });
});
