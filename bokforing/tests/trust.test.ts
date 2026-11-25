import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, newBackupCodes, normalizeBackupCode, otpauthUri, totp, totpStep, verifyTotp } from '@/lib/totp';
import { buildSie4, decodeSie, encodeCp437, parseSie, sieAmount, sieProblems, sieTokens } from '@/lib/sie';

describe('TOTP (RFC 6238/4226)', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it('base32', () => {
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq').toString()).toBe('12345678901234567890');
  });
  it('testvektorer', () => {
    expect(hotp(secret, 0)).toBe('755224');
    expect(hotp(secret, 9)).toBe('520489');
    expect(totp(secret, 59_000)).toBe('287082');
    expect(totp(secret, 1111111109_000)).toBe('081804');
    expect(totp(secret, 2000000000_000)).toBe('279037');
  });
  it('fönster ±30 s', () => {
    const t = 1111111109_000;
    expect(verifyTotp(secret, '081804', t + 30_000)).toBe(true);
    expect(verifyTotp(secret, '081 804', t)).toBe(true);
    expect(verifyTotp(secret, '081804', t + 90_000)).toBe(false);
    expect(verifyTotp(secret, '12345', t)).toBe(false);
    expect(totpStep(secret, '081804', t)).toBe(Math.floor(1111111109 / 30));
  });
  it('reservkoder och URI', () => {
    const c = newBackupCodes();
    expect(c).toHaveLength(10);
    expect(new Set(c).size).toBe(10);
    expect(c[0]).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
    expect(normalizeBackupCode(c[0].toUpperCase().replace('-', ' '))).toBe(c[0].replace('-', ''));
    expect(otpauthUri(secret, 'a@b.se')).toBe(`otpauth://totp/Ordna:a%40b.se?secret=${secret}&issuer=Ordna&algorithm=SHA1&digits=6&period=30`);
  });
});

describe('SIE-import', () => {
  it('fält och belopp', () => {
    expect(sieTokens('#VER "A" 12 20260115 "Hyra \\"jan\\"" 20260116')).toEqual(['#VER', 'A', '12', '20260115', 'Hyra "jan"', '20260116']);
    expect(sieTokens('#TRANS 1930 {1 "Proj 1"} -1250.50 20260115 "Text"')).toEqual(['#TRANS', '1930', '{1 "Proj 1"}', '-1250.50', '20260115', 'Text']);
    expect(sieAmount('-1250.5')).toBe(-125050);
    expect(sieAmount('1 000,00')).toBe(100000);
    expect(() => sieAmount('12.345')).toThrow();
  });
  it('export → import ger samma innehåll (CP437)', () => {
    const text = buildSie4({
      companyName: 'Åkeri & Söner AB', orgnr: '556026-9986', fiscalYear: { start: '2026-01-01', end: '2026-12-31' },
      accounts: [{ number: 1930, name: 'Företagskonto' }, { number: 2081, name: 'Aktiekapital' }, { number: 3001, name: 'Försäljning' }, { number: 2611, name: 'Utgående moms 25 %' }],
      openingBalances: new Map([[1930, 2500000], [2081, -2500000]]), closingBalances: new Map(), results: new Map(),
      vouchers: [{ series: 'A', number: 1, date: '2026-02-01', description: 'Försäljning "kontant"', created: '2026-02-01',
        lines: [{ account: 1930, amount: 125000 }, { account: 3001, amount: -100000, description: 'Tjänst' }, { account: 2611, amount: -25000 }] }],
    });
    const f = parseSie(decodeSie(encodeCp437(text)));
    expect(f.companyName).toBe('Åkeri & Söner AB');
    expect(f.years[0]).toEqual({ start: '2026-01-01', end: '2026-12-31' });
    expect(f.accounts.find((a) => a.number === 2611)?.name).toBe('Utgående moms 25 %');
    expect(f.openingBalances[0]).toEqual({ 1930: 2500000, 2081: -2500000 });
    expect(f.vouchers).toEqual([{ series: 'A', number: '1', date: '2026-02-01', description: 'Försäljning "kontant"',
      lines: [{ account: 1930, amount: 125000, description: '' }, { account: 3001, amount: -100000, description: 'Tjänst' }, { account: 2611, amount: -25000, description: '' }] }]);
    expect(sieProblems(f)).toEqual([]);
  });
  it('UTF-8, #RTRANS/#BTRANS räknas inte, fel hittas', () => {
    const text = ['#FLAGGA 0', '#FNAMN "Bolaget"', '#RAR 0 20260101 20261231', '#IB 0 1930 100.00', '#IB 0 2081 -50.00',
      '#VER B 7 20260310 "Rättad"', '{', '#TRANS 1930 {} 100', '#BTRANS 1930 {} 999', '#RTRANS 6110 {} -100', '#TRANS 6110 {} -100', '}',
      '#VER B 8 20270101 "Fel år"', '{', '#TRANS 1930 {} 10', '#TRANS 3001 {} -5', '}'].join('\n');
    const f = parseSie(decodeSie(new TextEncoder().encode(text)));
    expect(f.vouchers[0].lines).toEqual([{ account: 1930, amount: 10000, description: '' }, { account: 6110, amount: -10000, description: '' }]);
    const p = sieProblems(f);
    expect(p).toContain('Verifikation B8 balanserar inte (5.00)');
    expect(p).toContain('Verifikation B8 (2027-01-01) ligger utanför räkenskapsåret');
    expect(p).toContain('Ingående balanser går inte jämnt ut (differens 50.00)');
  });
});
