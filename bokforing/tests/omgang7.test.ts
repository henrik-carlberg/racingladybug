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
