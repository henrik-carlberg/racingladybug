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

import { bankDay, drawFile, mandateFile, parseResultFile } from '@/lib/autogiro';
import { DEFAULT_TEMPLATES, renderTemplate, unknownPlaceholders } from '@/lib/email-templates';
import { behavior, predict } from '@/lib/payment-forecast';
describe('autogiro', () => {
  const c = { bankgiro: '123-4567', customerNo: '123456' };
  it('poster om 80 tecken: öppning, medgivande, dragning', () => {
    const m = mandateFile(c, '2026-11-20', [{ payerNumber: '42', clearing: '8327', account: '9123456789', idNumber: '198001010019' }]).split('\r\n').filter(Boolean);
    expect(m.every((l) => l.length === 80)).toBe(true);
    expect(m[0]).toMatch(/^0120261120AUTOGIRO\s+1234560001234567\s*$/);
    expect(m[1].slice(0, 2)).toBe('04');
    expect(m[1].slice(2, 12)).toBe('0001234567');
    expect(m[1].slice(12, 28)).toBe('0000000000000042');
    const d = drawFile(c, '2026-11-20', [{ date: '2026-11-30', payerNumber: '42', amount: 125000, reference: '104205' }]).split('\r\n').filter(Boolean);
    expect(d[1].length).toBe(80);
    expect(d[1].slice(0, 11)).toBe('82202611300');
    expect(d[1].slice(31, 43)).toBe('000000125000');
  });
  it('återrapporten läses tillbaka med status', () => {
    const line = drawFile(c, '2026-11-20', [{ date: '2026-11-30', payerNumber: '42', amount: 125000, reference: '104205' }]).split('\r\n')[1];
    const ok = parseResultFile(line.slice(0, 79) + '0');
    expect(ok[0]).toMatchObject({ payerNumber: '42', amount: 125000, reference: '104205', ok: true, date: '2026-11-30' });
    expect(parseResultFile(line.slice(0, 79) + '1')[0]).toMatchObject({ ok: false, status: 'Täckning saknas' });
  });
  it('bankdag', () => { expect(bankDay('2026-11-21')).toBe('2026-11-23'); expect(bankDay('2026-11-20')).toBe('2026-11-20'); });
});
describe('e-postmallar och betalningsprognos', () => {
  it('fält ersätts, tomma rader slås ihop, okända fält hittas', () => {
    const r = renderTemplate(DEFAULT_TEMPLATES.invoice, { kund: 'Kund AB', företag: 'Bolaget', fakturanummer: '7', belopp: '100,00 kr', förfallodatum: '2026-12-01', ocr: '75', bankgiro: '123-4567', länk: 'L', meddelande: '' });
    expect(r.subject).toBe('Faktura 7 från Bolaget');
    expect(r.body).toContain('Hej Kund AB,\n\nFaktura 7: 100,00 kr');
    expect(unknownPlaceholders({ subject: '{kund}', body: '{okänt}' })).toEqual(['okänt']);
  });
  it('kund som brukar betala sent', () => {
    const b = behavior([{ due: '2026-01-31', paid: '2026-02-14' }, { due: '2026-02-28', paid: '2026-03-10' }, { due: '2026-03-31', paid: '2026-03-30' }]);
    expect(b).toMatchObject({ count: 3, avgDelay: 8 });
    expect(predict('2026-12-01', b)).toEqual({ expected: '2026-12-09', late: true, delay: 8 });
    expect(behavior([{ due: '2026-01-31', paid: '2026-02-14' }])).toBeNull();
  });
});

import { inflateRawSync } from 'node:zlib';
import { crc32, zip } from '@/lib/zip';
import { workbook } from '@/lib/xlsx';
import { budgetAsLedger, incomeStatement, minusYear, pctChange } from '@/lib/statements';
/** Läser tillbaka en zip (lokala poster) */
function unzip(b: Buffer) {
  const out: Record<string, string> = {};
  let p = 0;
  while (b.readUInt32LE(p) === 0x04034b50) {
    const csize = b.readUInt32LE(p + 18), nlen = b.readUInt16LE(p + 26), elen = b.readUInt16LE(p + 28), crc = b.readUInt32LE(p + 14);
    const name = b.subarray(p + 30, p + 30 + nlen).toString();
    const data = inflateRawSync(b.subarray(p + 30 + nlen + elen, p + 30 + nlen + elen + csize));
    expect(crc32(data)).toBe(crc);
    out[name] = data.toString();
    p += 30 + nlen + elen + csize;
  }
  expect(b.readUInt32LE(p)).toBe(0x02014b50);
  return out;
}
describe('Excel och jämförelser', () => {
  it('zip med rätt CRC och innehåll', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    expect(unzip(zip([{ name: 'a.txt', data: 'hej' }, { name: 'b/c.xml', data: '<x/>' }]))).toEqual({ 'a.txt': 'hej', 'b/c.xml': '<x/>' });
  });
  it('arbetsbok med tal, text och fet rubrik', () => {
    const f = unzip(workbook([{ name: 'Resultat: år/2026', header: true, rows: [['Konto', 'Belopp'], [{ v: 3001, fmt: 'int' }, { v: 1234.5, fmt: 'kr' }], ['A & B <c>', -7]] }]));
    expect(Object.keys(f)).toContain('xl/worksheets/sheet1.xml');
    expect(f['xl/workbook.xml']).toContain('name="Resultat  år 2026"');
    const sh = f['xl/worksheets/sheet1.xml'];
    expect(sh).toContain('<c r="A1" t="inlineStr" s="1">');
    expect(sh).toContain('<c r="B2" s="2"><v>1234.5</v></c>');
    expect(sh).toContain('A &amp; B &lt;c&gt;');
    expect(sh).toContain('<c r="B3" s="2"><v>-7</v></c>');
  });
  it('resultaträkning mot förra året och budget', () => {
    const names = new Map([[3001, 'Försäljning'], [5010, 'Hyra']]);
    const r = incomeStatement(new Map([[3001, -1000000], [5010, 300000]]), new Map([[3001, -800000], [5010, 300000]]), names);
    expect(r.result).toBe(700000);
    expect(r.compareResult).toBe(500000);
    expect(r.groups[0]).toMatchObject({ label: 'Nettoomsättning', total: 1000000, compareTotal: 800000 });
    expect([...budgetAsLedger(new Map([[3001, 900000], [5010, 250000]]))]).toEqual([[3001, -900000], [5010, 250000]]);
    expect(minusYear('2028-02-29')).toBe('2027-02-28');
    expect(pctChange(1000000, 800000)).toBe(25);
    expect(pctChange(5, null)).toBeNull();
  });
});
