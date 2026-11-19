import { describe, expect, it } from 'vitest';
import { compareScenarios, defaultParams, k10, scenario } from '@/lib/k10';

const base = { share: 100, costBasis: 2_500_000, savedSpace: 0, wages: 0, ownSalary: 0, dividends: 0 };

describe('3:12 och K10', () => {
  it('förenklingsregeln 2025 är 2,75 inkomstbasbelopp (209 550 kr)', () => {
    const r = k10(defaultParams(2025), base);
    expect(r.rule).toBe('förenkling');
    expect(r.limit).toBe(20_955_000);
  });
  it('grundbelopp 2026 är 4 inkomstbasbelopp (322 400 kr) fördelat efter ägarandel', () => {
    expect(k10(defaultParams(2026), base).limit).toBe(32_240_000);
    expect(k10(defaultParams(2026), { ...base, share: 50 }).limit).toBe(16_120_000);
  });
  it('lönebaserat utrymme 2026: 50 % av lönerna över 8 inkomstbasbelopp', () => {
    const r = k10(defaultParams(2026), { ...base, wages: 100_000_000 });
    expect(r.wageBased).toBe(Math.round(0.5 * (100_000_000 - 8 * 8_060_000)));
    expect(r.wageRequirementMet).toBeNull();
  });
  it('huvudregeln 2025 kräver att lönekravet är uppfyllt', () => {
    const noSalary = k10(defaultParams(2025), { ...base, wages: 200_000_000 });
    expect(noSalary.wageRequirementMet).toBe(false);
    expect(noSalary.rule).toBe('förenkling');
    const salary = k10(defaultParams(2025), { ...base, wages: 200_000_000, ownSalary: 80_000_000 });
    expect(salary.wageRequirementMet).toBe(true);
    expect(salary.rule).toBe('huvudregel');
    expect(salary.wageBased).toBe(100_000_000);
  });
  it('utdelning inom och över gränsbeloppet, sparat utrymme', () => {
    const r = k10(defaultParams(2026), { ...base, savedSpace: 1_000_000, dividends: 40_000_000 });
    expect(r.limit).toBe(33_240_000);
    expect(r.aboveLimit).toBe(40_000_000 - 33_240_000);
    expect(r.savedNext).toBe(0);
    expect(k10(defaultParams(2026), { ...base, dividends: 10_000_000 }).savedNext).toBe(22_240_000);
    expect(k10(defaultParams(2026), { ...base, share: 3, wages: 200_000_000 }).wageBased).toBe(0);
  });
});

describe('lön eller utdelning', () => {
  const p = { profit: 100_000_000, limit: 32_240_000, municipalTax: 32, stateThreshold: 64_300_000 };
  it('allt som utdelning inom gränsbeloppet', () => {
    const s = scenario({ ...p, profit: 10_000_000 }, 0);
    expect(s.corporateTax).toBe(2_060_000);
    expect(s.dividend).toBe(7_940_000);
    expect(s.net).toBe(Math.round(7_940_000 * 0.8));
  });
  it('bästa fördelningen är minst lika bra som de andra', () => {
    const c = compareScenarios(p);
    expect(c.best.net).toBeGreaterThanOrEqual(c.allSalary.net);
    expect(c.best.net).toBeGreaterThanOrEqual(c.allDividend.net);
    expect(c.allSalary.dividend).toBe(0);
    expect(c.allSalary.employerFee + c.allSalary.salary).toBeLessThanOrEqual(100_000_000);
  });
});

import { generateKeyPairSync, sign as rsaSign } from 'node:crypto';
import { maskPnr, personalNumberFrom, verifyIdToken } from '@/lib/bankid';
describe('BankID (OIDC id_token)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' };
  const now = Math.floor(Date.now() / 1000);
  const mk = (claims: object, key = privateKey, kid = 'k1') => {
    const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid })).toString('base64url');
    const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return `${h}.${p}.${rsaSign('RSA-SHA256', Buffer.from(`${h}.${p}`), key).toString('base64url')}`;
  };
  const good = { iss: 'https://idp.test', aud: 'app', exp: now + 300, iat: now, nonce: 'n1', sub: 'x', ssn: '198001010019', name: 'Ägare Testsson' };
  const o = { issuer: 'https://idp.test', clientId: 'app', nonce: 'n1' };
  it('godkänner rätt signerad token och läser personnumret', () => {
    const c = verifyIdToken(mk(good), { keys: [jwk as never] }, o);
    expect(personalNumberFrom(c)).toBe('198001010019');
    expect(maskPnr('198001010019')).toBe('19800101-****');
  });
  it('nekar fel signatur, utfärdare, mottagare, nonce och utgången token', () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    expect(() => verifyIdToken(mk(good, other), { keys: [jwk as never] }, o)).toThrow(/signatur/);
    expect(() => verifyIdToken(mk({ ...good, iss: 'https://evil' }), { keys: [jwk as never] }, o)).toThrow(/utfärdare/);
    expect(() => verifyIdToken(mk({ ...good, aud: 'other' }), { keys: [jwk as never] }, o)).toThrow(/mottagare/);
    expect(() => verifyIdToken(mk({ ...good, nonce: 'x' }), { keys: [jwk as never] }, o)).toThrow(/nonce/);
    expect(() => verifyIdToken(mk({ ...good, exp: now - 3600 }), { keys: [jwk as never] }, o)).toThrow(/gått ut/);
    expect(() => verifyIdToken(mk(good, privateKey, 'okänd'), { keys: [jwk as never] }, o)).toThrow(/nyckel/);
    const none = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(JSON.stringify(good)).toString('base64url')}.`;
    expect(() => verifyIdToken(none, { keys: [jwk as never] }, o)).toThrow(/stöds inte/);
  });
  it('personnummer i olika claims', () => {
    expect(personalNumberFrom({ ...good, ssn: undefined, nin: '19800101-0019' } as never)).toBe('198001010019');
    expect(personalNumberFrom({ ...good, ssn: '8001010019' } as never)).toBeNull();
  });
});
